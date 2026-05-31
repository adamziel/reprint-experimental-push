import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  getResource,
  resourceHash,
  serializeResourceValue,
  setResource,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0297-conflict-plan-apply-refusal-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const expectedCoverageTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

const safeFileResourceKey = 'file:index.php';
const decisionPostResourceKey = 'row:["wp_posts","ID:1"]';
const conflictPostResourceKey = 'row:["wp_posts","ID:2"]';

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0297";',
  '<?php echo "local-private-rpp0297-safe-file";',
  '<?php echo "remote-private-rpp0297-stale-file";',
  'Base private RPP-0297 decision post',
  'Base private RPP-0297 conflict post',
  'Remote private RPP-0297 keep-remote decision',
  'Local private RPP-0297 conflicting post title',
  'Remote private RPP-0297 conflicting post title',
]);

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
    claimHash: '9'.repeat(64),
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
      'index.php': '<?php echo "base-private-rpp0297";',
    },
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0297 decision post',
          post_status: 'publish',
        },
        'ID:2': {
          ID: 2,
          post_title: 'Base private RPP-0297 conflict post',
          post_status: 'publish',
        },
      },
    },
  };
}

function focusedConflictFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0297-safe-file";';
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0297 conflicting post title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0297 keep-remote decision';
  remote.db.wp_posts['ID:2'].post_title = 'Remote private RPP-0297 conflicting post title';

  return { base, local, remote };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function emittedCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function sortStrings(values) {
  return [...values].sort();
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function issueCodesFor(error) {
  return Array.isArray(error.details?.issues)
    ? error.details.issues.map((issue) => issue.code).sort()
    : [];
}

function minimalRefusalEvidence(error, beforeRemoteHash, afterRemoteHash, journalEvents) {
  return {
    code: error.code,
    issueCodes: issueCodesFor(error),
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${afterRemoteHash}`,
    durableJournalEventCount: journalEvents.length,
  };
}

function assertSummaryMatchesEmitted(plan, label) {
  assert.deepEqual(plan.summary, emittedCounts(plan), `${label} summary must match emitted evidence`);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${label} preconditions must match mutations`);

  const seenMutationIds = new Set();
  const preconditionsByMutationId = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(seenMutationIds.has(mutation.id), false, `${label} duplicate mutation id ${mutation.id}`);
    seenMutationIds.add(mutation.id);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${label} mutation resource key mismatch`);
  }

  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing live-remote precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope mismatch`);
    assert.equal(
      precondition.expectedHash,
      resourceHash(remote, mutation.resource),
      `${label} precondition should bind to live remote`,
    );
  }
}

function assertFocusedPlanSurface(fixture, plan) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === conflictPostResourceKey);
  const safeMutation = mutationFor(plan, safeFileResourceKey);

  assert.equal(plan.status, 'conflict');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assertSummaryMatchesEmitted(plan, 'RPP-0297 focused conflict fixture');
  assert.ok(conflict, 'expected focused row conflict');
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(mutationFor(plan, conflictPostResourceKey), undefined, 'conflict resource emitted a mutation');
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === conflictPostResourceKey),
    false,
    'conflict resource emitted a precondition',
  );
  assert.ok(safeMutation, 'expected independent safe file mutation');
  assert.equal(safeMutation.change.remoteChange, 'unchanged');
  assert.deepEqual(plan.decisions.map((decision) => decision.resourceKey), [decisionPostResourceKey]);
  assertEveryMutationHasLiveRemotePrecondition(plan, fixture.remote, 'RPP-0297 focused conflict fixture');
}

function hashOnlyPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutationResourceKeys: sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    preconditionResourceKeys: sortStrings(plan.preconditions.map((precondition) => precondition.resourceKey)),
    decisionResourceKeys: sortStrings(plan.decisions.map((decision) => decision.resourceKey)),
    conflictResourceKeys: sortStrings(plan.conflicts.map((conflict) => conflict.resourceKey)),
    conflictClasses: sortStrings(plan.conflicts.map((conflict) => conflict.class)),
    blockerClasses: sortStrings(plan.blockers.map((blocker) => blocker.class)),
    mutationHashes: plan.mutations.map((mutation) => ({
      idHash: `sha256:${digest(mutation.id)}`,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      evidenceHash: `sha256:${digest({
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    })),
    conflictHashes: plan.conflicts.map((conflict) => ({
      idHash: `sha256:${digest(conflict.id)}`,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy || null,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      evidenceHash: `sha256:${digest({
        id: conflict.id,
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        resolutionPolicy: conflict.resolutionPolicy || null,
        baseHash: conflict.baseHash,
        localHash: conflict.localHash,
        remoteHash: conflict.remoteHash,
      })}`,
    })),
  };
}

function readyTamper(plan, mutate) {
  const forged = cloneJson(plan);
  mutate(forged);
  forged.status = 'ready';
  forged.conflicts = [];
  forged.blockers = [];
  forged.summary = emittedCounts(forged);
  return forged;
}

function forgedConflictMutationPlan(fixture, plan) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === conflictPostResourceKey);
  assert.ok(conflict, 'missing focused conflict to forge into a mutation');
  const mutationId = 'mutation-rpp0297-forged-conflict-row-release-verifier-v5';
  const plannedValue = getResource(fixture.local, conflict.resource);

  return readyTamper(plan, (forged) => {
    forged.mutations.push({
      id: mutationId,
      resource: cloneJson(conflict.resource),
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
      resource: cloneJson(conflict.resource),
      resourceKey: conflict.resourceKey,
      expectedHash: conflict.remoteHash,
      checkedAgainst: 'live-remote',
    });
  });
}

function conflictPlanRefusal(remoteSnapshot, plan) {
  const remote = cloneJson(remoteSnapshot);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  let appliedMutations = 0;
  const error = captureError(() => {
    const result = applyPlan(remote, plan, {
      durableJournal: durableJournal(journalEvents),
    });
    appliedMutations = result.appliedMutations;
  });

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'conflict' });
  assert.equal(appliedMutations, 0);
  assert.equal(digest(remote), beforeRemoteHash);
  assert.deepEqual(journalEvents, []);

  return minimalRefusalEvidence(error, beforeRemoteHash, digest(remote), journalEvents);
}

function forgedReadyWithConflictEvidenceRefusal(remoteSnapshot, plan) {
  const forged = cloneJson(plan);
  forged.status = 'ready';
  const remote = cloneJson(remoteSnapshot);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(remote, forged, {
    durableJournal: durableJournal(journalEvents),
  }));
  const issueCodes = issueCodesFor(error);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issueCodes.includes('READY_PLAN_HAS_CONFLICTS'));
  assert.equal(digest(remote), beforeRemoteHash);
  assert.deepEqual(journalEvents, []);

  return minimalRefusalEvidence(error, beforeRemoteHash, digest(remote), journalEvents);
}

function forgedConflictMutationRefusal(fixture, plan) {
  const forged = forgedConflictMutationPlan(fixture, plan);
  const remote = cloneJson(fixture.remote);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(remote, forged, {
    durableJournal: durableJournal(journalEvents),
  }));
  const issueCodes = issueCodesFor(error);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    error.details.issues.some((issue) =>
      issue.code === 'MUTATION_REMOTE_CHANGE_NOT_UNCHANGED'
      && issue.resourceKey === conflictPostResourceKey
      && issue.remoteChange === 'update'),
    'forged conflict mutation must fail the ready-plan remote-change invariant',
  );
  assert.equal(digest(remote), beforeRemoteHash);
  assert.equal(remote.files['index.php'], fixture.remote.files['index.php'], 'safe mutation was staged');
  assert.equal(remote.db.wp_posts['ID:2'].post_title, fixture.remote.db.wp_posts['ID:2'].post_title);
  assert.deepEqual(journalEvents, []);
  assert.ok(issueCodes.includes('MUTATION_REMOTE_CHANGE_NOT_UNCHANGED'));

  return minimalRefusalEvidence(error, beforeRemoteHash, digest(remote), journalEvents);
}

function staleSafeMutationRefusal(fixture, plan) {
  const stalePlan = readyTamper(plan, () => {});
  const staleMutation = mutationFor(stalePlan, safeFileResourceKey);
  const stalePrecondition = preconditionFor(stalePlan, staleMutation);
  const remote = cloneJson(fixture.remote);
  remote.files['index.php'] = '<?php echo "remote-private-rpp0297-stale-file";';
  const actualHash = resourceHash(remote, staleMutation.resource);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(remote, stalePlan, {
    durableJournal: durableJournal(journalEvents),
  }));

  assert.notEqual(actualHash, staleMutation.remoteBeforeHash);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, safeFileResourceKey);
  assert.equal(error.details.expectedHash, stalePrecondition.expectedHash);
  assert.equal(error.details.actualHash, actualHash);
  assert.equal(digest(remote), beforeRemoteHash);
  assert.equal(remote.db.wp_posts['ID:2'].post_title, fixture.remote.db.wp_posts['ID:2'].post_title);
  assert.deepEqual(journalEvents, []);

  return {
    ...minimalRefusalEvidence(error, beforeRemoteHash, digest(remote), journalEvents),
    resourceKey: error.details.resourceKey,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
  };
}

function focusedConflictRefusalEvidence() {
  const fixture = focusedConflictFixture();
  const firstPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });
  const firstPlanEvidence = hashOnlyPlanEvidence(firstPlan);
  const replayPlanEvidence = hashOnlyPlanEvidence(replayPlan);
  const conflictApply = conflictPlanRefusal(fixture.remote, firstPlan);
  const forgedReadyWithConflictEvidence = forgedReadyWithConflictEvidenceRefusal(fixture.remote, firstPlan);
  const forgedConflictMutation = forgedConflictMutationRefusal(fixture, firstPlan);
  const staleSafeMutation = staleSafeMutationRefusal(fixture, firstPlan);

  assertFocusedPlanSurface(fixture, firstPlan);
  assertFocusedPlanSurface(fixture, replayPlan);
  assert.deepEqual(
    firstPlanEvidence,
    replayPlanEvidence,
    'RPP-0297 focused conflict refusal evidence changed between deterministic planning runs',
  );

  const evidence = {
    label: 'RPP-0297 focused conflict plan apply refusal release-verifier fixture',
    status: firstPlan.status,
    summary: firstPlan.summary,
    mutationResourceKeys: sortStrings(firstPlan.mutations.map((mutation) => mutation.resourceKey)),
    preconditionResourceKeys: sortStrings(firstPlan.preconditions.map((precondition) => precondition.resourceKey)),
    decisionResourceKeys: sortStrings(firstPlan.decisions.map((decision) => decision.resourceKey)),
    conflictResourceKeys: sortStrings(firstPlan.conflicts.map((conflict) => conflict.resourceKey)),
    conflictClasses: sortStrings(firstPlan.conflicts.map((conflict) => conflict.class)),
    planHash: `sha256:${digest(firstPlanEvidence)}`,
    refusals: {
      conflictApply,
      forgedReadyWithConflictEvidence,
      forgedConflictMutation,
      staleSafeMutation,
    },
  };

  assertHashOnlyEvidence(evidence);
  return evidence;
}

function generatedConflictCases() {
  const cases = generatePushHarnessCases();
  assert.equal(cases.length, DEFAULT_GENERATED_PUSH_CASES);
  return cases
    .map((testCase) => ({
      testCase,
      plan: createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedNow,
      }),
    }))
    .filter(({ plan }) => plan.status === 'conflict');
}

function generatedStaleMutationRefusal(testCase, plan) {
  if (plan.mutations.length === 0 || plan.blockers.length > 0) {
    return null;
  }

  const stalePlan = readyTamper(plan, () => {});
  const target = stalePlan.mutations[0];
  const remote = cloneJson(testCase.remote);
  setResource(remote, target.resource, deserializeResourceValue(target.value));
  const actualHash = resourceHash(remote, target.resource);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(remote, stalePlan, {
    durableJournal: durableJournal(journalEvents),
  }));

  assert.notEqual(actualHash, target.remoteBeforeHash, `${testCase.id} generated stale target did not drift`);
  assert.ok(error instanceof PushPlanError, `${testCase.id} generated stale attempt should throw`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${testCase.id} generated stale code`);
  assert.equal(error.details.resourceKey, target.resourceKey, `${testCase.id} generated stale resource key`);
  assert.equal(error.details.expectedHash, target.remoteBeforeHash, `${testCase.id} generated stale expected hash`);
  assert.equal(error.details.actualHash, actualHash, `${testCase.id} generated stale actual hash`);
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} generated stale attempt mutated remote`);
  assert.deepEqual(journalEvents, [], `${testCase.id} generated stale attempt wrote durable journal events`);

  return {
    resourceKey: target.resourceKey,
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${digest(remote)}`,
    durableJournalEventCount: journalEvents.length,
  };
}

function generatedConflictRefusalEvidence() {
  const cases = generatedConflictCases();
  const replayCases = generatedConflictCases();
  const evidence = {
    totalCases: DEFAULT_GENERATED_PUSH_CASES,
    conflictCases: cases.length,
    conflictCasesWithMutations: 0,
    staleMutationAttempts: 0,
    totalPlannedMutations: 0,
    totalPlannedPreconditions: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalDurableJournalEvents: 0,
    perTier: {},
    statuses: {},
    families: {},
    conflictClasses: {},
    refusalCodes: {},
    forgedIssueCodes: {},
    caseProofs: [],
  };

  assert.ok(cases.length > 0, 'generated harness must include conflict cases');
  assert.deepEqual(
    cases.map(({ testCase }) => testCase.id),
    replayCases.map(({ testCase }) => testCase.id),
    'generated conflict case selection must be deterministic',
  );

  for (const [index, { testCase, plan }] of cases.entries()) {
    const replayPlan = replayCases[index].plan;
    const planEvidence = hashOnlyPlanEvidence(plan);
    const replayPlanEvidence = hashOnlyPlanEvidence(replayPlan);
    const conflictApply = conflictPlanRefusal(testCase.remote, plan);
    const forgedReadyWithConflictEvidence = forgedReadyWithConflictEvidenceRefusal(testCase.remote, plan);
    const staleMutation = generatedStaleMutationRefusal(testCase, plan);

    assert.equal(plan.status, 'conflict', `${testCase.id} status changed`);
    assert.equal(replayPlan.status, 'conflict', `${testCase.id} replay status changed`);
    assertSummaryMatchesEmitted(plan, testCase.id);
    assertSummaryMatchesEmitted(replayPlan, `${testCase.id} replay`);
    assert.deepEqual(planEvidence, replayPlanEvidence, `${testCase.id} hash-only plan evidence changed`);
    assert.ok(plan.conflicts.length > 0, `${testCase.id} missing conflict evidence`);
    assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

    evidence.totalPlannedMutations += plan.mutations.length;
    evidence.totalPlannedPreconditions += plan.preconditions.length;
    evidence.totalConflicts += plan.conflicts.length;
    evidence.totalBlockers += plan.blockers.length;
    evidence.totalDurableJournalEvents += conflictApply.durableJournalEventCount
      + forgedReadyWithConflictEvidence.durableJournalEventCount
      + (staleMutation?.durableJournalEventCount || 0);
    if (plan.mutations.length > 0) {
      evidence.conflictCasesWithMutations++;
    }
    if (staleMutation) {
      evidence.staleMutationAttempts++;
      incrementCount(evidence.refusalCodes, staleMutation.code);
    }

    incrementCount(evidence.perTier, testCase.tier);
    incrementCount(evidence.statuses, plan.status);
    incrementCount(evidence.families, testCase.family);
    incrementCount(evidence.refusalCodes, conflictApply.code);
    incrementCount(evidence.refusalCodes, forgedReadyWithConflictEvidence.code);
    for (const issueCode of forgedReadyWithConflictEvidence.issueCodes) {
      incrementCount(evidence.forgedIssueCodes, issueCode);
    }
    for (const conflict of plan.conflicts) {
      incrementCount(evidence.conflictClasses, conflict.class);
    }

    evidence.caseProofs.push({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: plan.status,
      summary: plan.summary,
      planHash: `sha256:${digest(planEvidence)}`,
      conflictClassHash: `sha256:${digest(plan.conflicts.map((conflict) => conflict.class).sort())}`,
      plannedMutations: plan.mutations.length,
      plannedPreconditions: plan.preconditions.length,
      conflictApplyCode: conflictApply.code,
      forgedReadyCode: forgedReadyWithConflictEvidence.code,
      forgedIssueCodes: forgedReadyWithConflictEvidence.issueCodes,
      staleMutation: staleMutation
        ? {
            resourceKey: staleMutation.resourceKey,
            code: staleMutation.code,
            expectedHash: staleMutation.expectedHash,
            actualHash: staleMutation.actualHash,
            detailsHash: staleMutation.detailsHash,
          }
        : null,
    });
  }

  return {
    ...evidence,
    perTier: sortedNumericObject(evidence.perTier),
    statuses: sortedObject(evidence.statuses),
    families: sortedObject(evidence.families),
    conflictClasses: sortedObject(evidence.conflictClasses),
    refusalCodes: sortedObject(evidence.refusalCodes),
    forgedIssueCodes: sortedObject(evidence.forgedIssueCodes),
    caseProofHash: `sha256:${digest(evidence.caseProofs)}`,
  };
}

function aggregateFocusedEvidence(evidence) {
  const refusalCodes = {};
  const forgedIssueCodes = {};
  let durableJournalEventCount = 0;

  for (const refusal of Object.values(evidence.refusals)) {
    incrementCount(refusalCodes, refusal.code);
    durableJournalEventCount += refusal.durableJournalEventCount;
    for (const issueCode of refusal.issueCodes) {
      incrementCount(forgedIssueCodes, issueCode);
    }
  }

  return {
    totalCases: 1,
    statuses: { [evidence.status]: 1 },
    summary: evidence.summary,
    mutationResourceKeys: evidence.mutationResourceKeys,
    preconditionResourceKeys: evidence.preconditionResourceKeys,
    decisionResourceKeys: evidence.decisionResourceKeys,
    conflictResourceKeys: evidence.conflictResourceKeys,
    conflictClasses: evidence.conflictClasses,
    refusalCodes: sortedObject(refusalCodes),
    forgedIssueCodes: sortedObject(forgedIssueCodes),
    durableJournalEventCount,
  };
}

function assertGeneratedEvidence(evidence) {
  assert.equal(evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.deepEqual(Object.keys(evidence.perTier).map(Number), expectedCoverageTiers);
  assert.deepEqual(evidence.statuses, { conflict: evidence.conflictCases });
  assert.ok(evidence.conflictCases > 0, 'generated proof needs conflict cases');
  assert.ok(evidence.conflictCasesWithMutations > 0, 'generated proof needs conflict cases with safe mutations');
  assert.ok(evidence.staleMutationAttempts > 0, 'generated proof needs stale mutation attempts');
  assert.equal(evidence.totalPlannedPreconditions, evidence.totalPlannedMutations);
  assert.equal(evidence.totalDurableJournalEvents, 0);
  assert.equal(evidence.refusalCodes.PLAN_NOT_READY, evidence.conflictCases);
  assert.equal(evidence.refusalCodes.PLAN_INVARIANT_VIOLATION, evidence.conflictCases);
  assert.equal(evidence.refusalCodes.PRECONDITION_FAILED, evidence.staleMutationAttempts);
  assert.equal(evidence.forgedIssueCodes.READY_PLAN_HAS_CONFLICTS, evidence.conflictCases);
  assert.ok(evidence.conflictClasses['row-conflict'] > 0, 'generated proof needs row conflicts');
  assert.ok(evidence.conflictClasses['file-topology-conflict'] > 0, 'generated proof needs file topology conflicts');
  assert.ok(evidence.conflictClasses['plugin-data-conflict'] > 0, 'generated proof needs plugin data conflicts');
  assert.match(evidence.caseProofHash, sha256EvidencePattern);

  for (const proof of evidence.caseProofs) {
    assert.match(proof.planHash, sha256EvidencePattern);
    assert.match(proof.conflictClassHash, sha256EvidencePattern);
    if (proof.staleMutation) {
      assert.match(proof.staleMutation.expectedHash, sha256HexPattern);
      assert.match(proof.staleMutation.actualHash, sha256HexPattern);
      assert.match(proof.staleMutation.detailsHash, sha256EvidencePattern);
    }
  }
}

function assertHashOnlyEvidence(value) {
  assert.deepEqual(findEvidenceRedactionIssues(value), [], 'RPP-0297 evidence contains raw-value fields');

  const serialized = JSON.stringify(value);
  for (const rawValue of rawFixtureValues) {
    assert.equal(serialized.includes(rawValue), false, `hash-only evidence leaked ${rawValue}`);
  }
  for (const rawFieldName of ['post_title', 'option_value', 'payload', 'content']) {
    assert.equal(
      serialized.includes(`"${rawFieldName}"`),
      false,
      `hash-only evidence leaked raw field ${rawFieldName}`,
    );
  }
}

test('RPP-0297 release verifier v5 rejects forged and stale conflict-plan mutation attempts', () => {
  const firstFocusedEvidence = focusedConflictRefusalEvidence();
  const replayFocusedEvidence = focusedConflictRefusalEvidence();
  const firstGeneratedEvidence = generatedConflictRefusalEvidence();
  const replayGeneratedEvidence = generatedConflictRefusalEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const evidenceEnvelope = {
    rpp: 'RPP-0297',
    evidenceSource: 'conflict-plan-apply-refusal-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    focused: focusedAggregate,
    generated: {
      totalCases: firstGeneratedEvidence.totalCases,
      conflictCases: firstGeneratedEvidence.conflictCases,
      conflictCasesWithMutations: firstGeneratedEvidence.conflictCasesWithMutations,
      staleMutationAttempts: firstGeneratedEvidence.staleMutationAttempts,
      totalPlannedMutations: firstGeneratedEvidence.totalPlannedMutations,
      totalPlannedPreconditions: firstGeneratedEvidence.totalPlannedPreconditions,
      totalConflicts: firstGeneratedEvidence.totalConflicts,
      totalBlockers: firstGeneratedEvidence.totalBlockers,
      conflictClassCount: Object.keys(firstGeneratedEvidence.conflictClasses).length,
      familyCount: Object.keys(firstGeneratedEvidence.families).length,
      refusalCodes: firstGeneratedEvidence.refusalCodes,
      forgedIssueCodes: firstGeneratedEvidence.forgedIssueCodes,
    },
    focusedHash: `sha256:${digest(firstFocusedEvidence)}`,
    generatedHash: `sha256:${digest(firstGeneratedEvidence)}`,
    aggregateHash: `sha256:${digest({ focusedAggregate, generated: firstGeneratedEvidence })}`,
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0297 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0297 generated release-verifier evidence changed between runs',
  );
  assert.deepEqual(focusedAggregate, {
    totalCases: 1,
    statuses: {
      conflict: 1,
    },
    summary: {
      mutations: 1,
      decisions: 1,
      conflicts: 1,
      blockers: 0,
      atomicGroups: 0,
    },
    mutationResourceKeys: [safeFileResourceKey],
    preconditionResourceKeys: [safeFileResourceKey],
    decisionResourceKeys: [decisionPostResourceKey],
    conflictResourceKeys: [conflictPostResourceKey],
    conflictClasses: ['row-conflict'],
    refusalCodes: {
      PLAN_INVARIANT_VIOLATION: 2,
      PLAN_NOT_READY: 1,
      PRECONDITION_FAILED: 1,
    },
    forgedIssueCodes: {
      MUTATION_REMOTE_CHANGE_NOT_UNCHANGED: 1,
      READY_PLAN_HAS_CONFLICTS: 1,
    },
    durableJournalEventCount: 0,
  });
  assertGeneratedEvidence(firstGeneratedEvidence);
  assert.match(evidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(evidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(evidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence);
  assertHashOnlyEvidence(firstGeneratedEvidence);
  assertHashOnlyEvidence(evidenceEnvelope);
});
