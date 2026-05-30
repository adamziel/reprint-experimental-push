import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  getResource,
  resourceHash,
  serializeResourceValue,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: 'd'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0277-base-index";',
      'wp-content/themes/current/style.css': '/* rpp0277 base theme */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'RPP-0277 Base Site' },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'rpp0277-base-row-title', post_status: 'publish' },
      },
    },
  };
}

function rpp0277Fixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0277-local-independent-file";',
    'rpp0277-local-conflict-row-title',
    'rpp0277-remote-conflict-row-title',
    '<?php echo "rpp0277-stale-independent-file";',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];

  return {
    base,
    local,
    remote,
    privateValues,
    conflictResourceKey: 'row:["wp_posts","ID:1"]',
    independentResourceKey: 'file:index.php',
    staleIndependentFile: privateValues[3],
  };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote) {
  assert.equal(plan.preconditions.length, plan.mutations.length, 'preconditions must match mutations');
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, resourceHash(remote, mutation.resource));
  }
}

function readyTamper(plan, mutate) {
  const forged = cloneJson(plan);
  mutate(forged);
  forged.status = 'ready';
  forged.conflicts = [];
  forged.blockers = [];
  forged.summary = {
    ...forged.summary,
    mutations: forged.mutations.length,
    decisions: forged.decisions.length,
    conflicts: 0,
    blockers: 0,
    atomicGroups: forged.atomicGroups.length,
  };
  return forged;
}

function forgedConflictMutationPlan(fixture, plan) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === fixture.conflictResourceKey);
  assert.ok(conflict, 'missing conflict to forge into a mutation');
  const mutationId = 'mutation-rpp0277-forged-conflict-row';
  const plannedValue = getResource(fixture.local, conflict.resource);

  return readyTamper(plan, (forged) => {
    forged.mutations.push({
      id: mutationId,
      resource: conflict.resource,
      resourceKey: conflict.resourceKey,
      action: 'put',
      value: serializeResourceValue(plannedValue),
      remoteBeforeHash: conflict.remoteHash,
      baseHash: conflict.baseHash,
      localHash: resourceHash(fixture.local, conflict.resource),
      changeKind: 'update',
      change: cloneJson(conflict.change),
      atomicGroupId: null,
    });
    forged.preconditions.push({
      mutationId,
      resource: conflict.resource,
      resourceKey: conflict.resourceKey,
      expectedHash: conflict.remoteHash,
      checkedAgainst: 'live-remote',
    });
  });
}

function hashOnlyConflictEvidence(conflict) {
  return {
    id: conflict.id,
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    resolutionPolicy: conflict.resolutionPolicy,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    change: {
      localChange: conflict.change.localChange,
      remoteChange: conflict.change.remoteChange,
      baseHash: conflict.change.base.hash,
      localHash: conflict.change.local.hash,
      remoteHash: conflict.change.remote.hash,
    },
  };
}

function hashOnlyMutationEvidence(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    changeKind: mutation.changeKind,
    remoteChange: mutation.change.remoteChange,
  };
}

function refusalEvidence(error) {
  const issueCodes = Array.isArray(error.details?.issues)
    ? error.details.issues.map((issue) => issue.code).sort()
    : [];
  return {
    code: error.code,
    issueCodes,
    detailsHash: `sha256:${digest(error.details)}`,
  };
}

function assertNoPrivateValues(value, privateValues, label) {
  const serialized = JSON.stringify(value);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0277 conflict plan apply refusal v4 rejects forged conflict mutations and stale mutation attempts', () => {
  const fixture = rpp0277Fixture();
  const plan = planFor(fixture);
  const replayPlan = planFor({
    ...fixture,
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === fixture.conflictResourceKey);
  const independentMutation = mutationFor(plan, fixture.independentResourceKey);

  assert.equal(plan.status, 'conflict');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(plan, replayPlan, 'RPP-0277 conflict plan evidence must be deterministic');
  assert.ok(conflict, 'expected row conflict evidence');
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(mutationFor(plan, fixture.conflictResourceKey), undefined, 'conflict emitted a mutation');
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === fixture.conflictResourceKey),
    false,
    'conflict emitted a precondition',
  );
  assert.ok(independentMutation, 'expected independent file mutation');
  assert.equal(independentMutation.change.remoteChange, 'unchanged');
  assertEveryMutationHasLiveRemotePrecondition(plan, fixture.remote);

  const conflictRemote = cloneJson(fixture.remote);
  const conflictBeforeHash = digest(conflictRemote);
  const conflictEvents = [];
  let conflictAppliedMutations = 0;
  const conflictError = captureError(() => {
    const result = applyPlan(conflictRemote, plan, {
      mutateRemote: true,
      durableJournal: durableJournal(conflictEvents),
    });
    conflictAppliedMutations = result.appliedMutations;
  });

  assert.ok(conflictError instanceof PushPlanError);
  assert.equal(conflictError.code, 'PLAN_NOT_READY');
  assert.deepEqual(conflictError.details, { status: 'conflict' });
  assert.equal(conflictAppliedMutations, 0);
  assert.equal(digest(conflictRemote), conflictBeforeHash);
  assert.deepEqual(conflictEvents, []);

  const forgedPlan = forgedConflictMutationPlan(fixture, plan);
  const forgedRemote = cloneJson(fixture.remote);
  const forgedBeforeHash = digest(forgedRemote);
  const forgedEvents = [];
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(forgedEvents),
  }));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    forgedError.details.issues.some((issue) =>
      issue.code === 'MUTATION_REMOTE_CHANGE_NOT_UNCHANGED'
      && issue.resourceKey === fixture.conflictResourceKey
      && issue.remoteChange === 'update'),
    'forged conflict mutation must fail the ready-plan remote-change invariant',
  );
  assert.equal(digest(forgedRemote), forgedBeforeHash);
  assert.equal(forgedRemote.db.wp_posts['ID:1'].post_title, fixture.privateValues[2]);
  assert.deepEqual(forgedEvents, []);

  const stalePlan = readyTamper(plan, () => {});
  const staleRemote = cloneJson(fixture.remote);
  staleRemote.files['index.php'] = fixture.staleIndependentFile;
  const staleBeforeHash = digest(staleRemote);
  const staleActualHash = resourceHash(staleRemote, independentMutation.resource);
  const staleEvents = [];
  const staleError = captureError(() => applyPlan(staleRemote, stalePlan, {
    mutateRemote: true,
    durableJournal: durableJournal(staleEvents),
  }));

  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, fixture.independentResourceKey);
  assert.equal(staleError.details.expectedHash, independentMutation.remoteBeforeHash);
  assert.equal(staleError.details.actualHash, staleActualHash);
  assert.equal(digest(staleRemote), staleBeforeHash);
  assert.deepEqual(staleEvents, []);

  const evidence = {
    command: 'node --test test/rpp-0277-conflict-plan-apply-refusal-v4.test.js',
    status: plan.status,
    summary: plan.summary,
    conflict: hashOnlyConflictEvidence(conflict),
    independentMutation: hashOnlyMutationEvidence(independentMutation),
    refusals: {
      conflictApply: refusalEvidence(conflictError),
      forgedConflictMutation: refusalEvidence(forgedError),
      staleIndependentMutation: refusalEvidence(staleError),
    },
    remoteHashes: {
      conflictBeforeHash,
      conflictAfterHash: digest(conflictRemote),
      forgedBeforeHash,
      forgedAfterHash: digest(forgedRemote),
      staleBeforeHash,
      staleAfterHash: digest(staleRemote),
    },
    durableJournalEventCounts: {
      conflictApply: conflictEvents.length,
      forgedConflictMutation: forgedEvents.length,
      staleIndependentMutation: staleEvents.length,
    },
  };
  const evidenceEnvelope = {
    ...evidence,
    evidenceHash: `sha256:${digest(evidence)}`,
  };

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.refusals.conflictApply.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.refusals.forgedConflictMutation.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.refusals.staleIndependentMutation.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.remoteHashes.forgedBeforeHash, sha256Pattern);
  assertNoPrivateValues(evidenceEnvelope, fixture.privateValues, 'RPP-0277 hash-only evidence');
  assertNoPrivateValues(forgedError.details, fixture.privateValues, 'RPP-0277 forged refusal details');
  assertNoPrivateValues(staleError.details, fixture.privateValues, 'RPP-0277 stale refusal details');
});
