import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:20:00.000Z');
const command = 'node --test test/rpp-0289-conflict-evidence-hash-redaction-release-verifier-v5.test.js';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const postResourceKey = 'row:["wp_posts","ID:1"]';
const createdFilePath = 'wp-content/uploads/rpp-0289-private-conflict-report.txt';
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

function rpp0289ConflictFixture() {
  const raw = {
    fileLocal: 'rpp-0289-release-verifier-local-private-file-body',
    fileRemote: 'rpp-0289-release-verifier-remote-private-file-body',
    rowBase: 'rpp-0289-release-verifier-base-private-row-title',
    rowRemote: 'rpp-0289-release-verifier-remote-private-row-title',
    optionBase: 'rpp-0289-release-verifier-base-private-plugin-mode',
    optionLocal: 'rpp-0289-release-verifier-local-private-plugin-mode',
    optionRemote: 'rpp-0289-release-verifier-remote-private-plugin-mode',
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
    claimHash: '8'.repeat(64),
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

function hashOnlyChangeSummary(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: hashOnlySideSummary(change.base),
    local: hashOnlySideSummary(change.local),
    remote: hashOnlySideSummary(change.remote),
  };
}

function hashOnlySideSummary(side) {
  return {
    state: side.state,
    hash: side.hash,
    ...(side.fileType ? { fileType: side.fileType } : {}),
  };
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
      change: hashOnlyChangeSummary(conflict.change),
      conflictHash: sha256Evidence({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        pluginOwner: conflict.pluginOwner || null,
        resolutionPolicy: conflict.resolutionPolicy,
        baseHash: conflict.baseHash,
        localHash: conflict.localHash,
        remoteHash: conflict.remoteHash,
        change: hashOnlyChangeSummary(conflict.change),
      }),
    })),
  };
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked raw value ${rawValue}`);
  }
  for (const rawField of ['"content"', '"option_value"', '"post_title"', '"__pluginOwner"']) {
    assert.equal(serialized.includes(rawField), false, `${label} leaked raw field ${rawField}`);
  }
}

function summarizeConflictEvidenceHashRedactionReleaseVerifierProof() {
  const fixture = rpp0289ConflictFixture();
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
  const replayProjection = hashOnlyConflictProjection(replayPlan);

  const proof = {
    rpp: 'RPP-0289',
    behavior: 'Conflict evidence hash redaction release verifier, variant 5',
    command,
    evidenceSource: 'release-verifier-conflict-evidence-hash-redaction-v5',
    status: 'support_only',
    verdict: 'CONFLICT_EVIDENCE_HASH_REDACTED_SUPPORT_ONLY',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    releaseVerifier: {
      checkedBy: command,
      check: 'conflict-evidence-hash-redaction',
      variant: 'v5',
      conflictApplyRefusesBeforeMutation: true,
      deterministicReplay: true,
    },
    plan: {
      status: firstPlan.status,
      summary: firstPlan.summary,
      conflictCount: firstPlan.conflicts.length,
      mutationCount: firstPlan.mutations.length,
      preconditionCount: firstPlan.preconditions.length,
      planHash: sha256Evidence(projection),
      replayHash: sha256Evidence(replayProjection),
    },
    projection,
    refusal: {
      code: applyError.code,
      status: applyError.details.status,
      detailsHash: sha256Evidence(applyError.details),
      durableJournalEventCount: durableJournalEvents.length,
      remoteHashBefore: sha256Evidence(remoteBefore),
      remoteHashAfter: sha256Evidence(JSON.stringify(fixture.remote)),
    },
    redaction: {
      format: 'hash-only',
      evidenceSurfacesRedacted: true,
      rawValuesIncluded: false,
      rawFieldNamesIncluded: false,
      checkedFixtureCount: fixture.rawValues.length,
      surfaces: [
        'planner-conflict-records',
        'hash-only-conflict-projection',
        'apply-refusal-details',
        'release-verifier-proof',
      ],
    },
  };
  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    plan: proof.plan,
    projection: proof.projection,
    refusal: proof.refusal,
    redaction: proof.redaction,
  });

  return {
    fixture,
    firstPlan,
    replayPlan,
    applyError,
    proof,
    durableJournalEvents,
    remoteBefore,
  };
}

test('RPP-0289 release verifier carries conflict evidence hash redaction as hash-only support evidence', () => {
  const {
    fixture,
    firstPlan,
    replayPlan,
    applyError,
    proof,
    durableJournalEvents,
    remoteBefore,
  } = summarizeConflictEvidenceHashRedactionReleaseVerifierProof();

  assert.equal(proof.rpp, 'RPP-0289');
  assert.equal(proof.evidenceSource, 'release-verifier-conflict-evidence-hash-redaction-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'CONFLICT_EVIDENCE_HASH_REDACTED_SUPPORT_ONLY');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: command,
    check: 'conflict-evidence-hash-redaction',
    variant: 'v5',
    conflictApplyRefusesBeforeMutation: true,
    deterministicReplay: true,
  });

  assert.equal(firstPlan.status, 'conflict');
  assert.deepEqual(firstPlan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 3,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(proof.plan, {
    status: 'conflict',
    summary: firstPlan.summary,
    conflictCount: 3,
    mutationCount: 0,
    preconditionCount: 0,
    planHash: sha256Evidence(proof.projection),
    replayHash: sha256Evidence(hashOnlyConflictProjection(replayPlan)),
  });
  assert.equal(proof.plan.planHash, proof.plan.replayHash);
  assert.deepEqual(proof.projection, hashOnlyConflictProjection(replayPlan));
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
  assert.deepEqual(proof.refusal, {
    code: 'PLAN_NOT_READY',
    status: 'conflict',
    detailsHash: sha256Evidence({ status: 'conflict' }),
    durableJournalEventCount: 0,
    remoteHashBefore: sha256Evidence(remoteBefore),
    remoteHashAfter: sha256Evidence(JSON.stringify(fixture.remote)),
  });
  assert.equal(proof.refusal.remoteHashAfter, proof.refusal.remoteHashBefore);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.evidenceSurfacesRedacted, true);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.rawFieldNamesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, fixture.rawValues.length);
  assert.deepEqual(proof.redaction.surfaces, [
    'planner-conflict-records',
    'hash-only-conflict-projection',
    'apply-refusal-details',
    'release-verifier-proof',
  ]);

  assert.match(proof.refusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.refusal.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  for (const conflict of proof.projection.conflicts) {
    assert.match(conflict.conflictHash, sha256EvidencePattern);
    assert.deepEqual(Object.keys(conflict.change.base).sort(), ['hash', 'state'].sort());
    assert.deepEqual(Object.keys(conflict.change.local).sort().filter((key) => key !== 'fileType'), ['hash', 'state']);
    assert.deepEqual(Object.keys(conflict.change.remote).sort().filter((key) => key !== 'fileType'), ['hash', 'state']);
  }
  assertNoRawValues(firstPlan.conflicts, fixture.rawValues, 'RPP-0289 conflict records');
  assertNoRawValues(applyError.details, fixture.rawValues, 'RPP-0289 refusal details');
  assertNoRawValues(proof, fixture.rawValues, 'RPP-0289 release verifier proof');
  assert.deepEqual(
    redactEvidence({ conflicts: firstPlan.conflicts, refusal: applyError.details, proof }),
    { conflicts: firstPlan.conflicts, refusal: applyError.details, proof },
  );
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstPlan.conflicts, { label: 'RPP-0289 conflict evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(applyError.details, { label: 'RPP-0289 refusal details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0289 release verifier proof' }));
});
