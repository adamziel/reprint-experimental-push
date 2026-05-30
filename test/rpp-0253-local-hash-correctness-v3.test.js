import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const expectedGeneratedTiers = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

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

function increment(counts, key) {
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

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '5'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function hashFieldEvidence(value) {
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: digest(value),
    valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHash(mutation) {
  return digest(deserializeResourceValue(mutation.value));
}

function hashOnlyPlanEvidence(plan, error = null, journalEvents = []) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: hashFieldEvidence(mutation.baseHash),
      localHash: hashFieldEvidence(mutation.localHash),
      remoteBeforeHash: hashFieldEvidence(mutation.remoteBeforeHash),
      plannedValueHash: plannedValueHash(mutation),
      changeKind: mutation.changeKind || null,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: hashFieldEvidence(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    refusal: error
      ? {
          code: error.code,
          issueCodes: (error.details?.issues || []).map((issue) => issue.code).sort(),
          detailsHash: digest(error.details),
        }
      : null,
    journalEventTypes: journalEvents.map((event) => event.type),
  };
}

function assertHashOnlyEvidence(evidence, forbiddenValues, label) {
  assert.deepEqual(findEvidenceRedactionIssues(evidence), [], `${label} should be hash-only evidence`);
  const serialized = JSON.stringify(evidence);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false, `${label} leaked raw value ${value}`);
  }
  return serialized;
}

function assertReadyMutationPrecondition(testCase, plan, mutation) {
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
  assert.ok(precondition, `${testCase.id} missing live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey, `${testCase.id} precondition resource key mismatch`);
  assert.deepEqual(precondition.resource, mutation.resource, `${testCase.id} precondition resource mismatch`);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${testCase.id} precondition hash mismatch`);
  assert.equal(precondition.checkedAgainst, 'live-remote', `${testCase.id} precondition was not live remote`);
  assert.equal(
    precondition.expectedHash,
    resourceHash(testCase.remote, mutation.resource),
    `${testCase.id} precondition must bind to the dry-run remote hash`,
  );
}

function assertGeneratedLocalHash(testCase, mutation) {
  assert.match(mutation.localHash, sha256HexPattern, `${testCase.id} ${mutation.resourceKey} localHash format`);
  assert.equal(
    mutation.localHash,
    plannedValueHash(mutation),
    `${testCase.id} ${mutation.resourceKey} localHash must bind to the serialized planned value`,
  );
  if (!mutation.wordpressGraphIdentity) {
    assert.equal(
      mutation.localHash,
      resourceHash(testCase.local, mutation.resource),
      `${testCase.id} ${mutation.resourceKey} localHash must bind to the generated local snapshot`,
    );
  }
}

function assertInvalidRawLocalHashFailsClosed(testCase, plan, rawPrivateValue) {
  const target = plan.mutations[0];
  assert.ok(target, `${testCase.id} should have a target mutation`);

  const forged = cloneJson(plan);
  const forgedMutation = forged.mutations.find((mutation) => mutation.id === target.id);
  forgedMutation.localHash = rawPrivateValue;

  const remote = cloneJson(testCase.remote);
  const beforeRemote = JSON.stringify(remote);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(remote, forged, {
    durableJournal: claimFencedDurableJournal(journalEvents),
  }));
  const evidence = hashOnlyPlanEvidence(forged, error, journalEvents);

  assert.ok(error instanceof PushPlanError, `${testCase.id} invalid raw localHash should raise PushPlanError`);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', `${testCase.id} invalid raw localHash error code`);
  assert.ok(
    error.details.issues.some((issue) => issue.code === 'LOCAL_HASH_INVALID'),
    `${testCase.id} invalid raw localHash did not report LOCAL_HASH_INVALID`,
  );
  assert.equal(JSON.stringify(remote), beforeRemote, `${testCase.id} mutated remote before localHash refusal`);
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} changed remote hash before localHash refusal`);
  assert.deepEqual(journalEvents, [], `${testCase.id} wrote durable journal before localHash refusal`);
  assertHashOnlyEvidence(evidence, [rawPrivateValue], `${testCase.id} invalid localHash refusal evidence`);
  assert.equal(
    JSON.stringify(error.details).includes(rawPrivateValue),
    false,
    `${testCase.id} raw private localHash leaked in refusal details`,
  );
}

test('RPP-0253 generated localHash correctness variant 3 serializes hash-only evidence', () => {
  const generatedCases = generatePushHarnessCases();
  const coverage = {
    totalCases: generatedCases.length,
    statuses: {},
    mutationCount: 0,
    readyCasesWithMutations: 0,
    readyMutationCount: 0,
    readyFamilies: {},
    readyTiers: {},
    invalidLocalHashRefusals: 0,
  };
  const rawPrivateValues = [];
  const planEvidenceProofs = [];

  assert.equal(generatedCases.length, DEFAULT_GENERATED_PUSH_CASES, 'unexpected generated harness case count');

  for (const testCase of generatedCases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const planEvidence = hashOnlyPlanEvidence(plan);

    increment(coverage.statuses, plan.status);
    coverage.mutationCount += plan.mutations.length;

    assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary mismatch`);
    assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary mismatch`);
    assert.equal(plan.summary.conflicts, plan.conflicts.length, `${testCase.id} conflict summary mismatch`);
    assert.equal(plan.summary.blockers, plan.blockers.length, `${testCase.id} blocker summary mismatch`);
    assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic group summary mismatch`);
    assertHashOnlyEvidence(planEvidence, plan.mutations.map((mutation) => JSON.stringify(mutation.value)), `${testCase.id} plan evidence`);

    for (const mutation of plan.mutations) {
      assertGeneratedLocalHash(testCase, mutation);
      assertReadyMutationPrecondition(testCase, plan, mutation);
    }

    if (plan.status === 'ready' && plan.mutations.length > 0) {
      const rawPrivateValue = `rpp0253-raw-private-local-hash-${testCase.id}`;
      rawPrivateValues.push(rawPrivateValue);
      coverage.readyCasesWithMutations++;
      coverage.readyMutationCount += plan.mutations.length;
      increment(coverage.readyFamilies, testCase.family);
      increment(coverage.readyTiers, String(testCase.tier));

      assertInvalidRawLocalHashFailsClosed(testCase, plan, rawPrivateValue);
      coverage.invalidLocalHashRefusals++;

      planEvidenceProofs.push({
        id: testCase.id,
        tier: testCase.tier,
        family: testCase.family,
        mutationCount: plan.mutations.length,
        firstMutation: {
          resourceKey: plan.mutations[0].resourceKey,
          localHash: plan.mutations[0].localHash,
          plannedValueHash: plannedValueHash(plan.mutations[0]),
          remoteBeforeHash: plan.mutations[0].remoteBeforeHash,
        },
      });
    }
  }

  const coverageEvidence = {
    rpp: 'RPP-0253',
    behavior: 'generated localHash correctness variant 3',
    totalCases: coverage.totalCases,
    statuses: sortedStringCounts(coverage.statuses),
    mutationCount: coverage.mutationCount,
    readyCasesWithMutations: coverage.readyCasesWithMutations,
    readyMutationCount: coverage.readyMutationCount,
    readyFamilies: sortedStringCounts(coverage.readyFamilies),
    readyTiers: sortedNumericCounts(coverage.readyTiers),
    invalidLocalHashRefusals: coverage.invalidLocalHashRefusals,
    proofHash: digest(planEvidenceProofs),
  };

  assert.ok(coverage.mutationCount >= 8000, 'expected broad generated mutation coverage');
  assert.ok(coverage.readyCasesWithMutations >= 300, 'expected broad ready-plan coverage');
  assert.ok(coverage.readyMutationCount >= 6000, 'expected broad ready mutation coverage');
  assert.ok(Object.keys(coverage.readyFamilies).length >= 30, 'expected many generated ready families');
  assert.deepEqual(Object.keys(sortedNumericCounts(coverage.readyTiers)), expectedGeneratedTiers);
  assert.equal(
    coverage.invalidLocalHashRefusals,
    coverage.readyCasesWithMutations,
    'every generated ready plan with mutations must refuse an invalid raw localHash before mutation',
  );
  assertHashOnlyEvidence(coverageEvidence, rawPrivateValues, 'RPP-0253 coverage evidence');
});
