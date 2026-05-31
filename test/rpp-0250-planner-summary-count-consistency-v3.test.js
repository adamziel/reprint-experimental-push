import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
} from '../scripts/harness/generated-push-cases.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const command = 'node --test test/rpp-0250-planner-summary-count-consistency-v3.test.js';
const caveat = 'Generated local/model evidence only; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function expectedStatusFromEmittedEvidence(plan) {
  if (plan.conflicts.length > 0) {
    return 'conflict';
  }
  if (plan.blockers.length > 0) {
    return 'blocked';
  }
  return 'ready';
}

function sortStrings(values) {
  return [...values].sort();
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortNestedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortNumericObject(value)]),
  );
}

function assertPlannerSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    emittedPlannerCounts(plan),
    `${label} summary must match emitted planner evidence counts`,
  );
  assert.equal(
    plan.status,
    expectedStatusFromEmittedEvidence(plan),
    `${label} status must match emitted conflicts/blockers`,
  );
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} preconditions must stay one-for-one with emitted mutations`,
  );
}

function plannerSummaryEvidenceEnvelope(testCase, plan) {
  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: sortStrings(testCase.tags),
    status: plan.status,
    summary: plan.summary,
    emitted: emittedPlannerCounts(plan),
    preconditions: plan.preconditions.length,
    mutationResourceKeys: sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    decisionResourceKeys: sortStrings(plan.decisions.map((decision) => decision.resourceKey)),
    conflictResourceKeys: sortStrings(plan.conflicts.map((conflict) => conflict.resourceKey)),
    conflictClasses: sortStrings(plan.conflicts.map((conflict) => conflict.class)),
    blockerResourceKeys: sortStrings(plan.blockers.map((blocker) => blocker.resourceKey || null)),
    blockerClasses: sortStrings(plan.blockers.map((blocker) => blocker.class)),
    atomicGroups: plan.atomicGroups
      .map((group) => ({
        id: group.id,
        status: group.status,
        mutationCount: group.mutationIds.length,
        conflictCount: group.conflicts.length,
        blockerCount: group.blockers.length,
        blockerClasses: sortStrings(group.blockers.map((blocker) => blocker.class)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function generatedPlannerSummaryEvidence() {
  return generatePushHarnessCases().map((testCase) => {
    const firstPlan = planFor(testCase);
    const replayPlan = planFor({
      ...testCase,
      base: cloneJson(testCase.base),
      local: cloneJson(testCase.local),
      remote: cloneJson(testCase.remote),
      tags: new Set(testCase.tags),
    });
    const firstEnvelope = plannerSummaryEvidenceEnvelope(testCase, firstPlan);
    const replayEnvelope = plannerSummaryEvidenceEnvelope(testCase, replayPlan);

    assertPlannerSummaryMatchesEvidence(firstPlan, `RPP-0250 generated ${testCase.id}`);
    assertPlannerSummaryMatchesEvidence(replayPlan, `RPP-0250 generated replay ${testCase.id}`);
    assert.deepEqual(
      firstEnvelope,
      replayEnvelope,
      `${testCase.id} planner summary evidence changed between deterministic runs`,
    );

    return {
      ...firstEnvelope,
      envelopeHash: `sha256:${digest(firstEnvelope)}`,
    };
  });
}

function aggregateGeneratedPlannerEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    statusByTier: {},
    tiers: {},
    featureFamilies: {},
    totalMutations: 0,
    totalDecisions: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalAtomicGroups: 0,
    totalPreconditions: 0,
    casesWithAtomicGroups: 0,
    maxMutationCount: 0,
    maxAtomicGroups: 0,
  };

  for (const entry of evidence) {
    incrementCount(aggregate.statuses, entry.status);
    aggregate.statusByTier[entry.status] ||= {};
    incrementCount(aggregate.statusByTier[entry.status], entry.tier);
    incrementCount(aggregate.tiers, entry.tier);
    incrementCount(aggregate.featureFamilies, entry.family);
    for (const tag of entry.tags) {
      incrementCount(aggregate.featureFamilies, tag);
    }
    aggregate.totalMutations += entry.summary.mutations;
    aggregate.totalDecisions += entry.summary.decisions;
    aggregate.totalConflicts += entry.summary.conflicts;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalAtomicGroups += entry.summary.atomicGroups;
    aggregate.totalPreconditions += entry.preconditions;
    aggregate.maxMutationCount = Math.max(aggregate.maxMutationCount, entry.summary.mutations);
    aggregate.maxAtomicGroups = Math.max(aggregate.maxAtomicGroups, entry.summary.atomicGroups);
    if (entry.summary.atomicGroups > 0) {
      aggregate.casesWithAtomicGroups++;
    }
  }

  return {
    ...aggregate,
    statuses: sortStringObject(aggregate.statuses),
    statusByTier: sortNestedNumericObject(aggregate.statusByTier),
    tiers: sortNumericObject(aggregate.tiers),
    featureFamilies: sortStringObject(aggregate.featureFamilies),
  };
}

function reportPlannerSummaryTotals(summary) {
  return {
    totalCases: summary.totalCases,
    statuses: summary.statuses,
    statusByTier: summary.statusByTier,
    tiers: summary.tiers,
    featureFamilies: summary.featureFamilies,
    totalMutations: summary.totalMutations,
    totalConflicts: summary.totalConflicts,
    totalBlockers: summary.totalBlockers,
    totalDecisions: summary.totalDecisions,
    totalPreconditions: summary.totalPreconditions,
  };
}

function reportComparablePlannerSummaryTotals(aggregate) {
  return {
    totalCases: aggregate.totalCases,
    statuses: aggregate.statuses,
    statusByTier: aggregate.statusByTier,
    tiers: aggregate.tiers,
    featureFamilies: aggregate.featureFamilies,
    totalMutations: aggregate.totalMutations,
    totalConflicts: aggregate.totalConflicts,
    totalBlockers: aggregate.totalBlockers,
    totalDecisions: aggregate.totalDecisions,
    totalPreconditions: aggregate.totalPreconditions,
  };
}

function assertHashOnlyEvidence(value) {
  const serialized = JSON.stringify(value);

  assert.equal(serialized.includes('<?php'), false, 'summary proof leaked file contents');
  for (const rawFieldName of ['option_value', 'post_title', 'post_content', 'payload', '__pluginOwner']) {
    assert.equal(serialized.includes(rawFieldName), false, `summary proof leaked raw field ${rawFieldName}`);
  }
}

test('RPP-0250 generated planner summary counts match emitted evidence deterministically', () => {
  const firstEvidence = generatedPlannerSummaryEvidence();
  const replayEvidence = generatedPlannerSummaryEvidence();
  const report = runGeneratedPushHarness();
  const aggregate = aggregateGeneratedPlannerEvidence(firstEvidence);
  const reportTotals = reportPlannerSummaryTotals(report.summary);
  const evidenceEnvelope = {
    rpp: 'RPP-0250',
    evidenceSource: 'planner-summary-count-consistency-v3',
    command,
    caveat,
    aggregate,
    aggregateHash: `sha256:${digest(aggregate)}`,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };

  assert.deepEqual(firstEvidence, replayEvidence, 'generated planner summary evidence changed between runs');
  assert.deepEqual(
    reportComparablePlannerSummaryTotals(aggregate),
    reportTotals,
    'generated report totals diverged from emitted planner evidence',
  );
  assert.equal(aggregate.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(aggregate.totalCases >= MIN_GENERATED_PUSH_CASES);
  assert.ok(aggregate.statuses.ready > 0, 'generated proof needs ready cases');
  assert.ok(aggregate.statuses.conflict > 0, 'generated proof needs conflict cases');
  assert.ok(aggregate.statuses.blocked > 0, 'generated proof needs blocked cases');
  assert.equal(aggregate.totalPreconditions, aggregate.totalMutations);
  assert.ok(aggregate.totalAtomicGroups > 0, 'generated proof needs atomic group cases');
  assert.ok(aggregate.casesWithAtomicGroups > 0, 'generated proof needs cases with atomic groups');
  assert.match(evidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assert.equal(
    firstEvidence.every((entry) => sha256EvidencePattern.test(entry.envelopeHash)),
    true,
    'every case summary envelope should have a stable evidence hash',
  );
  assertHashOnlyEvidence(firstEvidence);
  assertHashOnlyEvidence(evidenceEnvelope);
});
