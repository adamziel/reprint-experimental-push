import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256UriPattern = /^sha256:[a-f0-9]{64}$/;
const expectedGeneratedTiers = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
const expectedVariant3TargetTiers = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9']);

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

function incrementCount(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
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

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function keepRemoteDecisions(plan) {
  return plan.decisions.filter((decision) => decision.decision === 'keep-remote');
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertPlannerSummary(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} planner summary should match emitted arrays`,
  );
}

function assertDecisionOnly(plan, decision, label) {
  assert.equal(mutationFor(plan, decision.resourceKey), undefined, `${label} emitted mutation`);
  assert.equal(preconditionFor(plan, decision.resourceKey), undefined, `${label} emitted precondition`);
}

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const child of Object.values(value)) {
    collectStrings(child, output);
  }
}

function looksLikeGeneratedRawValue(value) {
  return /(?:<\?php|urn:reprint-push|base|Base|generated|Generated|independent|Independent|local|Local|ready|Ready|remote|Remote|shared|Shared|stale|post-author-target|comment-user-target)/.test(value);
}

function collectDecisionRawStrings(testCase, decision, rawStrings) {
  for (const snapshot of [testCase.base, testCase.local, testCase.remote]) {
    const strings = [];
    collectStrings(getResource(snapshot, decision.resource), strings);
    for (const value of strings) {
      if (
        value.length < 8
        || !/[A-Za-z]/.test(value)
        || !looksLikeGeneratedRawValue(value)
        || decision.resourceKey.includes(value)
      ) {
        continue;
      }
      rawStrings.add(value);
    }
  }
}

function assertHashOnlyEvidence(evidence, rawStrings, label) {
  assert.deepEqual(findEvidenceRedactionIssues(evidence), [], `${label} should be hash-only evidence`);
  const serialized = JSON.stringify(evidence);
  for (const rawString of rawStrings) {
    assert.equal(serialized.includes(rawString), false, `${label} leaked raw generated value ${rawString}`);
  }
}

function assertGeneratedKeepRemoteDecision({ testCase, plan, decision, appliedSite }) {
  const label = `${testCase.id} ${decision.resourceKey}`;

  assert.equal(decision.resource?.key, decision.resourceKey, `${label} resource key`);
  assert.equal(decision.decision, 'keep-remote', `${label} decision`);
  assert.equal(decision.change.localChange, 'unchanged', `${label} local change`);
  assert.ok(
    ['create', 'delete', 'update'].includes(decision.change.remoteChange),
    `${label} remote change should be create/delete/update`,
  );
  assert.match(decision.baseHash, sha256HexPattern, `${label} base hash`);
  assert.match(decision.remoteHash, sha256HexPattern, `${label} remote hash`);
  assert.equal(decision.change.base.hash, decision.baseHash, `${label} base change hash`);
  assert.equal(decision.change.local.hash, decision.baseHash, `${label} local unchanged hash`);
  assert.equal(decision.change.remote.hash, decision.remoteHash, `${label} remote change hash`);
  assert.equal(resourceHash(testCase.base, decision.resource), decision.baseHash, `${label} base resource hash`);
  assert.equal(resourceHash(testCase.local, decision.resource), decision.baseHash, `${label} local resource hash`);
  assert.equal(resourceHash(testCase.remote, decision.resource), decision.remoteHash, `${label} remote resource hash`);
  assert.notEqual(decision.remoteHash, decision.baseHash, `${label} remote hash should differ from base`);
  assertDecisionOnly(plan, decision, label);

  const appliedHash = appliedSite ? resourceHash(appliedSite, decision.resource) : null;
  if (appliedSite) {
    assert.equal(appliedHash, decision.remoteHash, `${label} apply should preserve remote value`);
  }

  return {
    resourceKey: decision.resourceKey,
    resourceType: decision.resource.type,
    decision: decision.decision,
    baseHash: decision.baseHash,
    localHash: decision.change.local.hash,
    remoteHash: decision.remoteHash,
    appliedHash,
    localChange: decision.change.localChange,
    remoteChange: decision.change.remoteChange,
    baseState: decision.change.base.state,
    localState: decision.change.local.state,
    remoteState: decision.change.remote.state,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function nonReadyRefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready apply should raise PushPlanError`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} non-ready refusal code`);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function collectGeneratedKeepRemoteEvidence(targetCoverage) {
  const generatedCases = generatePushHarnessCases();
  const rawStrings = new Set();
  const evidence = {
    rpp: 'RPP-0255',
    behavior: 'generated keep-remote decision coverage, variant 3',
    command: 'node --test --test-name-pattern=RPP-0255 test/rpp-0255-keep-remote-decision-v3.test.js',
    caveat: 'Deterministic local Node generated-fixture evidence only; release remains gated by broader integration evidence.',
    totalCases: generatedCases.length,
    targetCoverage: {
      remoteOnlyPreservationVariant3: targetCoverage,
    },
    statuses: {},
    keepRemoteCaseTiers: {},
    keepRemoteFamilies: {},
    keepRemoteResourceTypes: {},
    keepRemoteLocalChanges: {},
    keepRemoteRemoteChanges: {},
    casesWithKeepRemote: 0,
    readyCasesWithKeepRemote: 0,
    nonReadyCasesWithKeepRemote: 0,
    keepRemoteDecisionCount: 0,
    readyAppliedDecisionCount: 0,
    nonReadyRefusals: 0,
    caseProofs: [],
  };

  for (const testCase of generatedCases) {
    const plan = planFor(testCase);
    const decisions = keepRemoteDecisions(plan);

    assertPlannerSummary(plan, testCase.id);
    incrementCount(evidence.statuses, plan.status);

    if (decisions.length === 0) {
      continue;
    }

    let appliedSite = null;
    let refusal = null;

    incrementCount(evidence.keepRemoteCaseTiers, String(testCase.tier));
    incrementCount(evidence.keepRemoteFamilies, testCase.family);
    evidence.casesWithKeepRemote += 1;

    if (plan.status === 'ready') {
      const applied = applyPlan(cloneJson(testCase.remote), plan);
      appliedSite = applied.site;
      evidence.readyCasesWithKeepRemote += 1;
      evidence.readyAppliedDecisionCount += decisions.length;
    } else {
      refusal = nonReadyRefusalEvidence(testCase, plan);
      evidence.nonReadyCasesWithKeepRemote += 1;
      evidence.nonReadyRefusals += 1;
    }

    const decisionProofs = decisions.map((decision) => {
      collectDecisionRawStrings(testCase, decision, rawStrings);
      const proof = assertGeneratedKeepRemoteDecision({
        testCase,
        plan,
        decision,
        appliedSite,
      });
      incrementCount(evidence.keepRemoteResourceTypes, proof.resourceType);
      incrementCount(evidence.keepRemoteLocalChanges, proof.localChange);
      incrementCount(evidence.keepRemoteRemoteChanges, proof.remoteChange);
      evidence.keepRemoteDecisionCount += 1;
      return proof;
    });

    evidence.caseProofs.push({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: plan.status,
      planSummary: plan.summary,
      decisionCount: decisions.length,
      decisions: decisionProofs,
      refusal,
      caseProofHash: `sha256:${digest(decisionProofs)}`,
    });
  }

  evidence.statuses = sortStringObject(evidence.statuses);
  evidence.keepRemoteCaseTiers = sortNumericObject(evidence.keepRemoteCaseTiers);
  evidence.keepRemoteFamilies = sortStringObject(evidence.keepRemoteFamilies);
  evidence.keepRemoteResourceTypes = sortStringObject(evidence.keepRemoteResourceTypes);
  evidence.keepRemoteLocalChanges = sortStringObject(evidence.keepRemoteLocalChanges);
  evidence.keepRemoteRemoteChanges = sortStringObject(evidence.keepRemoteRemoteChanges);
  evidence.redactedRawStringCount = rawStrings.size;
  evidence.redactedRawStringHash = `sha256:${digest([...rawStrings].sort())}`;

  return { evidence, rawStrings };
}

test('RPP-0255 generated keep-remote decisions are decision-only across variant 3 coverage', () => {
  const report = runGeneratedPushHarness();
  const targetCoverage = report.summary.targetCoverage.remoteOnlyPreservationVariant3;

  assert.ok(targetCoverage, 'missing remote-only preservation variant 3 target coverage');
  assert.equal(targetCoverage.family, 'remote-only-preservation-variant3');
  assert.equal(targetCoverage.total, 9);
  assert.deepEqual(Object.keys(targetCoverage.perTier), expectedVariant3TargetTiers);
  assert.deepEqual(targetCoverage.statuses, { ready: 9 });

  const first = collectGeneratedKeepRemoteEvidence(targetCoverage);
  const replay = collectGeneratedKeepRemoteEvidence(targetCoverage);
  const evidenceEnvelope = {
    ...first.evidence,
    evidenceHash: `sha256:${digest(first.evidence.caseProofs)}`,
  };

  assert.deepEqual(
    first.evidence,
    replay.evidence,
    'RPP-0255 generated keep-remote evidence changed between deterministic runs',
  );
  assert.equal(first.evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.deepEqual(first.evidence.statuses, {
    blocked: 74,
    conflict: 201,
    ready: 345,
  });
  assert.deepEqual(Object.keys(first.evidence.keepRemoteCaseTiers), expectedGeneratedTiers);
  assert.equal(first.evidence.casesWithKeepRemote, 533);
  assert.equal(first.evidence.readyCasesWithKeepRemote, 284);
  assert.equal(first.evidence.nonReadyCasesWithKeepRemote, 249);
  assert.equal(first.evidence.keepRemoteDecisionCount, 1575);
  assert.equal(first.evidence.readyAppliedDecisionCount, 706);
  assert.equal(first.evidence.nonReadyRefusals, first.evidence.nonReadyCasesWithKeepRemote);
  assert.deepEqual(first.evidence.keepRemoteResourceTypes, {
    file: 316,
    plugin: 20,
    row: 1239,
  });
  assert.deepEqual(first.evidence.keepRemoteLocalChanges, { unchanged: 1575 });
  assert.deepEqual(first.evidence.keepRemoteRemoteChanges, {
    create: 514,
    delete: 20,
    update: 1041,
  });
  assert.ok(
    Object.keys(first.evidence.keepRemoteFamilies).length >= 60,
    'expected broad generated keep-remote family coverage',
  );
  assert.ok(first.evidence.redactedRawStringCount >= 150, 'expected generated raw values to redact');
  assert.match(first.evidence.redactedRawStringHash, sha256UriPattern);
  assert.match(evidenceEnvelope.evidenceHash, sha256UriPattern);
  assertHashOnlyEvidence(evidenceEnvelope, first.rawStrings, 'RPP-0255 keep-remote evidence');
});
