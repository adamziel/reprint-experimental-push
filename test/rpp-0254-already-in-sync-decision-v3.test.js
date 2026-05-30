import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256UriPattern = /^sha256:[a-f0-9]{64}$/;

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

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1;
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

function alreadyInSyncDecisions(plan) {
  return plan.decisions.filter((decision) => decision.decision === 'already-in-sync');
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function hashOnlyDecisionEvidence(decision, { appliedHash = null } = {}) {
  return {
    id: decision.id,
    resourceKey: decision.resourceKey,
    resourceType: decision.resource?.type || null,
    decision: decision.decision,
    baseHash: decision.baseHash,
    localHash: decision.localHash,
    remoteHash: decision.change.remote.hash,
    appliedHash,
    localChange: decision.change.localChange,
    remoteChange: decision.change.remoteChange,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function postTitleFor(testCase, decision) {
  const localValue = getResource(testCase.local, decision.resource);
  const remoteValue = getResource(testCase.remote, decision.resource);
  assert.deepEqual(localValue, remoteValue, `${testCase.id} ${decision.resourceKey} local/remote value mismatch`);
  return typeof localValue?.post_title === 'string' ? localValue.post_title : null;
}

function assertGeneratedAlreadyInSyncDecision({ testCase, plan, decision, appliedSite }) {
  assert.equal(decision.decision, 'already-in-sync', `${testCase.id} decision kind`);
  assert.equal(decision.resource?.type, 'row', `${testCase.id} already-in-sync generated resource type`);
  assert.equal(decision.change.localChange, 'update', `${testCase.id} local change kind`);
  assert.equal(decision.change.remoteChange, 'update', `${testCase.id} remote change kind`);
  assert.equal(decision.change.base.state, 'present', `${testCase.id} base state`);
  assert.equal(decision.change.local.state, 'present', `${testCase.id} local state`);
  assert.equal(decision.change.remote.state, 'present', `${testCase.id} remote state`);
  assert.match(decision.baseHash, sha256Pattern, `${testCase.id} base hash`);
  assert.match(decision.localHash, sha256Pattern, `${testCase.id} local hash`);
  assert.match(decision.change.remote.hash, sha256Pattern, `${testCase.id} remote hash`);
  assert.notEqual(decision.baseHash, decision.localHash, `${testCase.id} synced row should differ from base`);
  assert.equal(decision.localHash, decision.change.local.hash, `${testCase.id} local hash mismatch`);
  assert.equal(decision.localHash, decision.change.remote.hash, `${testCase.id} remote hash mismatch`);
  assert.equal(resourceHash(testCase.base, decision.resource), decision.baseHash, `${testCase.id} base resource hash`);
  assert.equal(resourceHash(testCase.local, decision.resource), decision.localHash, `${testCase.id} local resource hash`);
  assert.equal(resourceHash(testCase.remote, decision.resource), decision.localHash, `${testCase.id} remote resource hash`);
  assert.equal(mutationFor(plan, decision.resourceKey), undefined, `${testCase.id} emitted mutation for ${decision.resourceKey}`);
  assert.equal(preconditionFor(plan, decision.resourceKey), undefined, `${testCase.id} emitted precondition for ${decision.resourceKey}`);

  if (appliedSite) {
    assert.equal(
      resourceHash(appliedSite, decision.resource),
      resourceHash(testCase.remote, decision.resource),
      `${testCase.id} apply changed already-in-sync resource ${decision.resourceKey}`,
    );
  }
}

function assertNoRawTitles(evidence, rawTitles) {
  const serialized = JSON.stringify(evidence);
  for (const rawTitle of new Set(rawTitles.filter(Boolean))) {
    assert.equal(serialized.includes(rawTitle), false, `hash-only evidence leaked ${rawTitle}`);
  }
}

test('RPP-0254 generated already-in-sync decisions are decision-only across variant 3 coverage', () => {
  const report = runGeneratedPushHarness();
  const targetCoverage = report.summary.targetCoverage.sameIndependentContentVariant3;
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('already-in-sync'));
  const coverage = {
    rpp: 'RPP-0254',
    behavior: 'generated already-in-sync decision coverage, variant 3',
    command: 'node --test --test-name-pattern=RPP-0254 test/rpp-0254-already-in-sync-decision-v3.test.js',
    sameIndependentContentVariant3: targetCoverage,
    totalCases: generatedCases.length,
    perTier: {},
    statuses: {},
    alreadyInSyncDecisionCount: 0,
    caseProofs: [],
  };
  const rawSyncedTitles = [];

  assert.ok(targetCoverage, 'missing same independent content variant 3 target coverage');
  assert.equal(targetCoverage.family, 'same-independent-content-variant3');
  assert.equal(targetCoverage.total, 10);
  assert.deepEqual(targetCoverage.perTier, Object.fromEntries(expectedTiers.map((tier) => [tier, 1])));
  assert.deepEqual(targetCoverage.statuses, { ready: 10 });
  assert.equal(generatedCases.length, 79, 'expected deterministic generated cases tagged already-in-sync');

  for (const testCase of generatedCases) {
    const validation = validateGeneratedCase(testCase);
    const plan = planFor(testCase);
    const decisions = alreadyInSyncDecisions(plan);
    let appliedSite = null;
    let refusal = null;

    incrementCount(coverage.perTier, testCase.tier);
    incrementCount(coverage.statuses, plan.status);
    coverage.alreadyInSyncDecisionCount += decisions.length;

    assert.equal(validation.status, plan.status, `${testCase.id} validation/plan status mismatch`);
    assert.ok(decisions.length >= 1, `${testCase.id} should carry at least one already-in-sync decision`);
    assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary mismatch`);
    assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary mismatch`);
    assert.equal(plan.summary.conflicts, plan.conflicts.length, `${testCase.id} conflict summary mismatch`);
    assert.equal(plan.summary.blockers, plan.blockers.length, `${testCase.id} blocker summary mismatch`);
    assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic group summary mismatch`);

    if (plan.status === 'ready') {
      assert.equal(validation.applied, true, `${testCase.id} generated validation should apply`);
      assert.equal(validation.unplannedRemotePreserved, true, `${testCase.id} generated validation should preserve unplanned remote resources`);
      appliedSite = applyPlan(cloneJson(testCase.remote), plan).site;
    } else {
      const remoteBefore = cloneJson(testCase.remote);
      const remoteBeforeHash = digest(remoteBefore);
      refusal = captureError(() => applyPlan(remoteBefore, plan));
      assert.ok(refusal instanceof PushPlanError, `${testCase.id} non-ready apply should throw PushPlanError`);
      assert.equal(refusal.code, 'PLAN_NOT_READY', `${testCase.id} non-ready refusal code`);
      assert.equal(validation.applied, false, `${testCase.id} generated validation should not apply`);
      assert.equal(validation.nonReadyRemoteUnchanged, true, `${testCase.id} generated validation should preserve non-ready remote`);
      assert.equal(digest(remoteBefore), remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);
    }

    const sameIndependentTargets = [];
    const decisionProofs = decisions.map((decision) => {
      assertGeneratedAlreadyInSyncDecision({ testCase, plan, decision, appliedSite });
      const syncedTitle = postTitleFor(testCase, decision);
      rawSyncedTitles.push(syncedTitle);
      if (syncedTitle?.startsWith('Shared independent ')) {
        sameIndependentTargets.push(decision.resourceKey);
      }
      return hashOnlyDecisionEvidence(decision, {
        appliedHash: appliedSite ? resourceHash(appliedSite, decision.resource) : null,
      });
    });

    if (testCase.family === 'same-independent-content') {
      assert.equal(
        sameIndependentTargets.length,
        1,
        `${testCase.id} should include exactly one same-independent-content target decision`,
      );
    }

    coverage.caseProofs.push({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: plan.status,
      planSummary: plan.summary,
      validation: {
        applied: validation.applied,
        unplannedRemotePreserved: validation.unplannedRemotePreserved || false,
        nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged || false,
      },
      alreadyInSyncDecisionCount: decisions.length,
      sameIndependentTargetKeys: sameIndependentTargets,
      decisionProofs,
      refusal: refusal
        ? {
            code: refusal.code,
            detailsHash: `sha256:${digest(refusal.details)}`,
          }
        : null,
      caseProofHash: `sha256:${digest(decisionProofs)}`,
    });
  }

  coverage.perTier = sortNumericObject(coverage.perTier);
  coverage.statuses = sortStringObject(coverage.statuses);
  coverage.evidenceHash = `sha256:${digest(coverage.caseProofs)}`;

  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 36,
    9: 35,
  });
  assert.deepEqual(coverage.statuses, { blocked: 8, ready: 71 });
  assert.equal(coverage.alreadyInSyncDecisionCount, 232);
  assert.match(coverage.evidenceHash, sha256UriPattern);
  assert.equal(
    coverage.caseProofs.filter((entry) => entry.family === 'same-independent-content').length,
    targetCoverage.total,
  );
  assertNoRawTitles(coverage, rawSyncedTitles);
  assert.equal(JSON.stringify(coverage).includes('Shared independent '), false);
  assert.equal(JSON.stringify(coverage).includes('Ready same content '), false);
});
