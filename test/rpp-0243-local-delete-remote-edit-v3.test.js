import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedCoverageTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

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

function incrementCount(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function sortedNumericCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortedStringCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
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
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: decision.baseHash,
      localHash: decision.localHash || null,
      remoteHash: decision.remoteHash || null,
      change: decision.change,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy || null,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      change: conflict.change,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
    })),
    atomicGroups: plan.atomicGroups.map((group) => ({
      id: group.id,
      status: group.status,
      mutationIds: group.mutationIds,
      blockerIds: group.blockerIds,
    })),
  };
}

function generatedDeleteEditCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'delete-edit-conflict' || testCase.tags.has('delete-edit'));
}

function generatedDeleteEditTarget(testCase) {
  const rowEntries = Object.entries(testCase.remote.db.wp_posts)
    .filter(([rowId, row]) =>
      testCase.base.db.wp_posts[rowId]
      && !testCase.local.db.wp_posts[rowId]
      && row.post_title?.startsWith('Remote edit while local deletes '));

  assert.equal(rowEntries.length, 1, `${testCase.id} should expose exactly one delete/edit target row`);

  const [rowId, remoteRow] = rowEntries[0];
  return {
    rowId,
    rowKey: `row:["wp_posts","${rowId}"]`,
    baseTitle: testCase.base.db.wp_posts[rowId].post_title,
    remoteTitle: remoteRow.post_title,
  };
}

function assertSerializedEvidenceOmitsRawValues(serializedEvidence, rawValues, context) {
  for (const rawValue of new Set(rawValues)) {
    assert.equal(
      serializedEvidence.includes(rawValue),
      false,
      `${context} leaked raw generated delete/edit value: ${rawValue}`,
    );
  }
}

function assertEveryGeneratedMutationHasLiveRemotePrecondition(testCase, plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${testCase.id} missing live-remote precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

test('RPP-0243 generated local delete versus remote edit variant 3 redacts serialized plan evidence', () => {
  const report = runGeneratedPushHarness();
  const harnessCoverage = report.summary.targetCoverage.localDeleteRemoteEdit;
  const generatedCases = generatedDeleteEditCases();
  const recountedCoverage = {
    family: 'delete-edit-conflict',
    total: 0,
    perTier: {},
    statuses: {},
  };
  const proofRows = [];
  const targetRawValues = [];

  assert.ok(harnessCoverage, 'missing generated local delete versus remote edit target coverage');
  assert.equal(harnessCoverage.family, 'delete-edit-conflict');
  assert.equal(generatedCases.length, harnessCoverage.total);

  for (const generatedCase of generatedCases) {
    assert.equal(generatedCase.family, 'delete-edit-conflict');
    assert.ok(generatedCase.tags.has('delete-edit'), `${generatedCase.id} missing delete-edit tag`);
    assert.ok(generatedCase.tags.has('expected-conflict'), `${generatedCase.id} missing expected-conflict tag`);

    const validation = validateGeneratedCase(generatedCase);
    const plan = createPushPlan({
      base: generatedCase.base,
      local: generatedCase.local,
      remote: generatedCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const target = generatedDeleteEditTarget(generatedCase);
    const rawValues = [target.baseTitle, target.remoteTitle];
    const conflict = plan.conflicts.find((entry) => entry.resourceKey === target.rowKey);
    const rowMutation = plan.mutations.find((mutation) => mutation.resourceKey === target.rowKey);
    const rowPrecondition = plan.preconditions.find((precondition) => precondition.resourceKey === target.rowKey);
    const planEvidence = hashOnlyPlanEvidence(plan);
    const serializedPlanEvidence = JSON.stringify(planEvidence);
    const replayRemote = cloneJson(generatedCase.remote);
    const replayBefore = JSON.stringify(replayRemote);
    const error = captureError(() => applyPlan(replayRemote, plan));

    incrementCount(recountedCoverage.perTier, generatedCase.tier);
    incrementCount(recountedCoverage.statuses, validation.status);
    recountedCoverage.total += 1;
    targetRawValues.push(...rawValues);

    assert.equal(plan.status, 'conflict');
    assert.equal(validation.status, 'conflict');
    assert.equal(validation.applied, false);
    assert.equal(validation.nonReadyRemoteUnchanged, true);
    assert.ok(conflict, `${generatedCase.id} missing local delete versus remote edit conflict`);
    assert.equal(conflict.class, 'row-conflict');
    assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
    assert.equal(conflict.change.localChange, 'delete');
    assert.equal(conflict.change.remoteChange, 'update');
    assert.equal(conflict.change.base.state, 'present');
    assert.equal(conflict.change.local.state, 'absent');
    assert.equal(conflict.change.remote.state, 'present');
    assert.match(conflict.remoteHash, /^[a-f0-9]{64}$/);
    assert.equal(conflict.change.remote.hash, conflict.remoteHash);
    assert.equal(rowMutation, undefined, `${generatedCase.id} must not mutate the delete/edit target row`);
    assert.equal(rowPrecondition, undefined, `${generatedCase.id} must not precondition the delete/edit target row`);
    assertEveryGeneratedMutationHasLiveRemotePrecondition(generatedCase, plan);

    assert.deepEqual(
      findEvidenceRedactionIssues(planEvidence),
      [],
      `${generatedCase.id} hash-only plan evidence should not contain raw evidence fields`,
    );
    assertSerializedEvidenceOmitsRawValues(serializedPlanEvidence, rawValues, generatedCase.id);

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(JSON.stringify(replayRemote), replayBefore, `${generatedCase.id} conflict apply mutated remote state`);
    assert.equal(replayRemote.db.wp_posts[target.rowId].post_title, target.remoteTitle);
    assertSerializedEvidenceOmitsRawValues(JSON.stringify(error.details), rawValues, `${generatedCase.id} refusal details`);

    proofRows.push({
      id: generatedCase.id,
      tier: generatedCase.tier,
      status: plan.status,
      rowKey: target.rowKey,
      conflictClass: conflict.class,
      localChange: conflict.change.localChange,
      remoteChange: conflict.change.remoteChange,
      remoteHash: conflict.remoteHash,
      mutations: plan.mutations.length,
      preconditions: plan.preconditions.length,
    });
  }

  recountedCoverage.perTier = sortedNumericCounts(recountedCoverage.perTier);
  recountedCoverage.statuses = sortedStringCounts(recountedCoverage.statuses);

  assert.deepEqual(recountedCoverage, harnessCoverage);
  assert.deepEqual(Object.keys(recountedCoverage.perTier).map(Number), expectedCoverageTiers);
  assert.deepEqual(recountedCoverage.statuses, { conflict: recountedCoverage.total });

  const serializedProofEvidence = JSON.stringify({
    checklistItem: 'RPP-0243',
    coverage: recountedCoverage,
    cases: proofRows,
  });
  assert.deepEqual(
    findEvidenceRedactionIssues({ coverage: recountedCoverage, cases: proofRows }),
    [],
    'RPP-0243 generated proof evidence should not contain raw evidence fields',
  );
  assertSerializedEvidenceOmitsRawValues(serializedProofEvidence, targetRawValues, 'RPP-0243 generated proof evidence');
});
