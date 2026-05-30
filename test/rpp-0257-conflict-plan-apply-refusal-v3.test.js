import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedCoverageTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const hashPattern = /^[a-f0-9]{64}$/;

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

function claimOpenedDurableJournal(events) {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: '7'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function generatedConflictCases() {
  return generatePushHarnessCases()
    .map((testCase) => ({ testCase, plan: planFor(testCase) }))
    .filter(({ plan }) => plan.status === 'conflict');
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function sortedStringCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortedNumericCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function assertSummaryMatchesPlan(testCase, plan) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${testCase.id} summary must match emitted evidence`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(testCase, plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} must emit exactly one live-remote precondition per mutation`,
  );

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${testCase.id} missing live-remote precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${testCase.id} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${testCase.id} precondition resource mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${testCase.id} precondition hash mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${testCase.id} precondition source changed`);
    assert.equal(
      precondition.expectedHash,
      resourceHash(testCase.remote, mutation.resource),
      `${testCase.id} precondition must bind to the generated remote snapshot`,
    );
  }
}

function hashOnlyPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy || null,
      pluginOwner: conflict.pluginOwner || null,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      relatedResourceKey: conflict.relatedResourceKey || null,
      conflictHash: `sha256:${digest(conflict)}`,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
      reasonCode: blocker.reasonCode || null,
      blockerHash: `sha256:${digest(blocker)}`,
    })),
  };
}

function assertHashOnlyEvidenceIsRedacted(evidence, forbiddenValues, label) {
  assert.deepEqual(
    findEvidenceRedactionIssues(evidence),
    [],
    `${label} should not contain raw-value evidence fields`,
  );

  const serialized = JSON.stringify(evidence);
  for (const value of new Set(forbiddenValues.filter(Boolean))) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw generated value: ${value}`);
  }
}

function collectGeneratedRawValues(value, collected = new Set()) {
  if (typeof value === 'string') {
    if (isGeneratedRawValue(value)) {
      collected.add(value);
    }
    return collected;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeneratedRawValues(item, collected);
    }
    return collected;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      collectGeneratedRawValues(child, collected);
    }
  }
  return collected;
}

function isGeneratedRawValue(value) {
  if (value.includes('<?php')) {
    return true;
  }
  if (value.length < 6) {
    return false;
  }
  if (!/\s/.test(value) && !/^[{[]/.test(value) && !/^(?:a|O|s|i|b|d):\d+[:;]/.test(value)) {
    return false;
  }
  return /\b(?:local|remote|generated|conflict|bulk|payload|serialized|fixture|child|delete|update)\b/i.test(value)
    || /\bbase (?:post|file|shared)\b/i.test(value)
    || value.length >= 40;
}

function applyConflictPlanRefusal(testCase, plan) {
  const remote = cloneJson(testCase.remote);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(remote, plan, {
      durableJournal: claimOpenedDurableJournal(journalEvents),
      beforeMutation() {
        beforeMutationCalls++;
      },
    });
    appliedMutationCount = result.appliedMutations;
  });

  assert.ok(error instanceof PushPlanError, `${testCase.id} conflict apply should throw PushPlanError`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} conflict apply code changed`);
  assert.deepEqual(error.details, { status: 'conflict' }, `${testCase.id} conflict apply details changed`);
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} conflict apply mutated remote`);
  assert.equal(appliedMutationCount, 0, `${testCase.id} conflict apply reported applied mutations`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} conflict apply reached mutation hook`);
  assert.deepEqual(journalEvents, [], `${testCase.id} conflict apply wrote durable journal events`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${digest(remote)}`,
    durableJournalEventCount: journalEvents.length,
    mutationHookCalls: beforeMutationCalls,
  };
}

function forgedReadyConflictEvidenceRefusal(testCase, plan) {
  const forgedPlan = cloneJson(plan);
  forgedPlan.status = 'ready';
  const remote = cloneJson(testCase.remote);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, forgedPlan, {
    durableJournal: claimOpenedDurableJournal(journalEvents),
    beforeMutation() {
      beforeMutationCalls++;
    },
  }));
  const issueCodes = error.details.issues.map((issue) => issue.code).sort();

  assert.ok(error instanceof PushPlanError, `${testCase.id} forged ready conflict plan should throw`);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', `${testCase.id} forged ready conflict code changed`);
  assert.ok(
    issueCodes.includes('READY_PLAN_HAS_CONFLICTS'),
    `${testCase.id} forged ready status must reject retained conflict evidence`,
  );
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} forged ready conflict plan mutated remote`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} forged ready conflict reached mutation hook`);
  assert.deepEqual(journalEvents, [], `${testCase.id} forged ready conflict plan wrote durable journal events`);

  return {
    code: error.code,
    issueCodes,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${digest(remote)}`,
    durableJournalEventCount: journalEvents.length,
    mutationHookCalls: beforeMutationCalls,
  };
}

function staleMutationAttemptRefusal(testCase, plan) {
  if (plan.mutations.length === 0 || plan.blockers.length > 0) {
    return null;
  }

  const forgedReadyPlan = cloneJson(plan);
  forgedReadyPlan.status = 'ready';
  forgedReadyPlan.conflicts = [];
  forgedReadyPlan.summary.conflicts = 0;
  const target = forgedReadyPlan.mutations[0];
  const remote = cloneJson(testCase.remote);
  setResource(remote, target.resource, deserializeResourceValue(target.value));
  const actualHash = resourceHash(remote, target.resource);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, forgedReadyPlan, {
    durableJournal: claimOpenedDurableJournal(journalEvents),
    beforeMutation() {
      beforeMutationCalls++;
    },
  }));

  assert.notEqual(actualHash, target.remoteBeforeHash, `${testCase.id} stale mutation target did not drift`);
  assert.ok(error instanceof PushPlanError, `${testCase.id} stale forged conflict plan should throw`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${testCase.id} stale forged conflict code changed`);
  assert.equal(error.details.resourceKey, target.resourceKey, `${testCase.id} stale resource key changed`);
  assert.equal(error.details.expectedHash, target.remoteBeforeHash, `${testCase.id} stale expected hash changed`);
  assert.equal(error.details.actualHash, actualHash, `${testCase.id} stale actual hash changed`);
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} stale forged conflict plan mutated remote`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale forged conflict reached mutation hook`);
  assert.deepEqual(journalEvents, [], `${testCase.id} stale forged conflict wrote durable journal events`);

  return {
    resourceKey: target.resourceKey,
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${digest(remote)}`,
    durableJournalEventCount: journalEvents.length,
    mutationHookCalls: beforeMutationCalls,
  };
}

test('RPP-0257 generated conflict plan apply refusal variant 3 rejects forged or stale mutation attempts', () => {
  const generatedCases = generatedConflictCases();
  const replayCases = generatedConflictCases();
  const coverage = {
    checklistItem: 'RPP-0257',
    target: 'conflictPlanApplyRefusalVariant3',
    totalConflictCases: 0,
    totalPlannedMutations: 0,
    totalPlannedPreconditions: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalMutationHookCalls: 0,
    totalStaleMutationAttempts: 0,
    perTier: {},
    statuses: {},
    families: {},
    conflictClasses: {},
    refusalCodes: {},
    forgedIssueCodes: {},
    caseProofs: [],
  };
  const rawGeneratedValues = [];

  assert.ok(generatedCases.length > 0, 'generated harness must include conflict cases');
  assert.deepEqual(
    generatedCases.map(({ testCase }) => testCase.id),
    replayCases.map(({ testCase }) => testCase.id),
    'generated conflict case selection must be deterministic',
  );

  for (const { testCase, plan } of generatedCases) {
    const replayPlan = replayCases.find((entry) => entry.testCase.id === testCase.id).plan;
    const planEvidence = hashOnlyPlanEvidence(plan);
    const conflictRefusal = applyConflictPlanRefusal(testCase, plan);
    const forgedRefusal = forgedReadyConflictEvidenceRefusal(testCase, plan);
    const staleRefusal = staleMutationAttemptRefusal(testCase, plan);
    const mutationPayloads = plan.mutations.map((mutation) => JSON.stringify(mutation.value));
    const caseRawValues = [
      ...collectGeneratedRawValues(testCase.base),
      ...collectGeneratedRawValues(testCase.local),
      ...collectGeneratedRawValues(testCase.remote),
      ...mutationPayloads,
    ];

    rawGeneratedValues.push(...caseRawValues);
    coverage.totalConflictCases++;
    coverage.totalPlannedMutations += plan.mutations.length;
    coverage.totalPlannedPreconditions += plan.preconditions.length;
    coverage.totalConflicts += plan.conflicts.length;
    coverage.totalBlockers += plan.blockers.length;
    increment(coverage.perTier, testCase.tier);
    increment(coverage.statuses, plan.status);
    increment(coverage.families, testCase.family);
    increment(coverage.refusalCodes, conflictRefusal.code);
    increment(coverage.refusalCodes, forgedRefusal.code);
    for (const issueCode of forgedRefusal.issueCodes) {
      increment(coverage.forgedIssueCodes, issueCode);
    }
    for (const conflict of plan.conflicts) {
      increment(coverage.conflictClasses, conflict.class);
    }
    if (staleRefusal) {
      coverage.totalStaleMutationAttempts++;
      increment(coverage.refusalCodes, staleRefusal.code);
    }
    coverage.totalDurableJournalEvents += conflictRefusal.durableJournalEventCount
      + forgedRefusal.durableJournalEventCount
      + (staleRefusal?.durableJournalEventCount || 0);
    coverage.totalMutationHookCalls += conflictRefusal.mutationHookCalls
      + forgedRefusal.mutationHookCalls
      + (staleRefusal?.mutationHookCalls || 0);

    assert.equal(plan.status, 'conflict', `${testCase.id} status changed`);
    assert.equal(replayPlan.status, 'conflict', `${testCase.id} replay status changed`);
    assertSummaryMatchesPlan(testCase, plan);
    assertSummaryMatchesPlan(testCase, replayPlan);
    assert.deepEqual(planEvidence, hashOnlyPlanEvidence(replayPlan), `${testCase.id} hash-only plan evidence changed`);
    assert.ok(plan.conflicts.length > 0, `${testCase.id} missing conflict evidence`);
    assertEveryMutationHasLiveRemotePrecondition(testCase, plan);
    assertHashOnlyEvidenceIsRedacted(
      {
        plan: planEvidence,
        refusals: {
          conflictApply: conflictRefusal,
          forgedReadyWithConflictEvidence: forgedRefusal,
          staleMutationAttempt: staleRefusal,
        },
      },
      caseRawValues,
      testCase.id,
    );

    coverage.caseProofs.push({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: plan.status,
      summary: plan.summary,
      planHash: `sha256:${digest(planEvidence)}`,
      conflictClasses: plan.conflicts.map((conflict) => conflict.class).sort(),
      plannedMutations: plan.mutations.length,
      plannedPreconditions: plan.preconditions.length,
      refusal: conflictRefusal,
      forgedReadyWithConflictEvidence: {
        code: forgedRefusal.code,
        issueCodes: forgedRefusal.issueCodes,
        detailsHash: forgedRefusal.detailsHash,
      },
      staleMutationAttempt: staleRefusal
        ? {
            resourceKey: staleRefusal.resourceKey,
            code: staleRefusal.code,
            expectedHash: staleRefusal.expectedHash,
            actualHash: staleRefusal.actualHash,
            detailsHash: staleRefusal.detailsHash,
          }
        : null,
    });
  }

  coverage.perTier = sortedNumericCounts(coverage.perTier);
  coverage.statuses = sortedStringCounts(coverage.statuses);
  coverage.families = sortedStringCounts(coverage.families);
  coverage.conflictClasses = sortedStringCounts(coverage.conflictClasses);
  coverage.refusalCodes = sortedStringCounts(coverage.refusalCodes);
  coverage.forgedIssueCodes = sortedStringCounts(coverage.forgedIssueCodes);

  assert.deepEqual(Object.keys(coverage.perTier).map(Number), expectedCoverageTiers);
  assert.deepEqual(coverage.statuses, { conflict: coverage.totalConflictCases });
  assert.ok(coverage.totalPlannedMutations > 0, 'generated conflict plans must include independent mutations');
  assert.equal(coverage.totalPlannedPreconditions, coverage.totalPlannedMutations);
  assert.ok(coverage.totalStaleMutationAttempts > 0, 'generated proof must exercise stale mutation attempts');
  assert.equal(coverage.totalAppliedMutations, 0);
  assert.equal(coverage.totalDurableJournalEvents, 0);
  assert.equal(coverage.totalMutationHookCalls, 0);
  assert.equal(coverage.refusalCodes.PLAN_NOT_READY, coverage.totalConflictCases);
  assert.equal(coverage.refusalCodes.PLAN_INVARIANT_VIOLATION, coverage.totalConflictCases);
  assert.equal(coverage.refusalCodes.PRECONDITION_FAILED, coverage.totalStaleMutationAttempts);
  assert.equal(coverage.forgedIssueCodes.READY_PLAN_HAS_CONFLICTS, coverage.totalConflictCases);
  assert.ok(coverage.conflictClasses['row-conflict'] > 0, 'generated proof must cover row conflicts');
  assert.ok(coverage.conflictClasses['file-topology-conflict'] > 0, 'generated proof must cover file topology conflicts');
  assert.ok(coverage.conflictClasses['plugin-data-conflict'] > 0, 'generated proof must cover plugin data conflicts');
  for (const proof of coverage.caseProofs) {
    assert.match(proof.planHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(proof.refusal.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(proof.forgedReadyWithConflictEvidence.detailsHash, /^sha256:[a-f0-9]{64}$/);
    if (proof.staleMutationAttempt) {
      assert.match(proof.staleMutationAttempt.expectedHash, hashPattern);
      assert.match(proof.staleMutationAttempt.actualHash, hashPattern);
      assert.match(proof.staleMutationAttempt.detailsHash, /^sha256:[a-f0-9]{64}$/);
    }
  }
  assertHashOnlyEvidenceIsRedacted(coverage, rawGeneratedValues, 'RPP-0257 generated coverage');
});
