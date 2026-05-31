import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const coverageKey = 'atomicPluginInstallStack';
const stackTag = 'atomic-plugin-install-stack-v3';
const readyTag = 'atomic-plugin-stack-ready-v3';
const missingDependencyTag = 'atomic-plugin-stack-missing-dependency-v3';
const groupId = 'install-generated-dependent-without-dependency';
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';
const dependentFileResourceKey =
  `file:wp-content/plugins/${atomicDependentPlugin}/${atomicDependentPlugin}.php`;
const dependentPluginResourceKey = `plugin:${atomicDependentPlugin}`;
const dependencyPluginResourceKey = `plugin:${atomicDependencyPlugin}`;

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

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function expectedPerTier(count) {
  return Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), count]));
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function sortedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortedStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '6'.repeat(64),
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

function generatedAtomicBlockerVariant3Cases() {
  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(missingDependencyTag));

  assert.equal(cases.length, 10, 'RPP-0260 needs one missing-dependency v3 atomic group per tier');
  assert.deepEqual(
    sortedNumericObject(Object.fromEntries(cases.map((testCase) => [String(testCase.tier), 1]))),
    expectedPerTier(1),
    'RPP-0260 generated v3 cases should span tiers 0 through 9',
  );
  return cases;
}

function assertPlanSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary does not match emitted plan evidence`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, testCase) {
  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${testCase.id} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }

  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} should emit exactly one live-remote precondition per planned mutation`,
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${testCase.id} precondition resource key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${testCase.id} precondition resource`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${testCase.id} precondition scope`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${testCase.id} precondition hash`);
    assert.equal(
      resourceHash(testCase.remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${testCase.id} mutation ${mutation.resourceKey} remote hash`,
    );
    assert.match(mutation.baseHash, sha256HexPattern, `${testCase.id} mutation baseHash`);
    assert.match(mutation.localHash, sha256HexPattern, `${testCase.id} mutation localHash`);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern, `${testCase.id} mutation remoteBeforeHash`);
  }
}

function assertNonReadyApplyRefusesBeforeMutation(testCase, plan) {
  const remote = cloneJson(testCase.remote);
  const beforeRemoteHash = digest(remote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  let appliedMutationCount = 0;
  const error = captureError(() => {
    const result = applyPlan(remote, plan, {
      durableJournal: claimFencedDurableJournal(journalEvents),
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
    appliedMutationCount = result.appliedMutations;
  });

  assert.ok(error instanceof PushPlanError, `${testCase.id} should throw PushPlanError`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} apply refusal code changed`);
  assert.deepEqual(error.details, { status: plan.status }, `${testCase.id} refusal details changed`);
  assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} changed remote before refusing apply`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} reached the mutation callback`);
  assert.equal(appliedMutationCount, 0, `${testCase.id} reported applied mutations`);
  assert.deepEqual(journalEvents, [], `${testCase.id} wrote durable journal events before refusal`);

  return {
    code: error.code,
    status: error.details.status,
    detailsHash: sha256Evidence(error.details),
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: sha256Evidence(remote),
    durableJournalEventCount: journalEvents.length,
    beforeMutationCalls,
    appliedMutationCount,
  };
}

function groupMutationsFor(plan, group, testCase) {
  const mutationsById = new Map(plan.mutations.map((mutation) => [mutation.id, mutation]));
  const mutations = group.mutationIds.map((mutationId) => mutationsById.get(mutationId));

  assert.equal(
    mutations.every(Boolean),
    true,
    `${testCase.id} atomic group must reference only emitted mutations`,
  );
  return mutations;
}

function assertNoRawGeneratedValues(evidenceText, testCase, groupMutations) {
  const forbiddenNeedles = [
    '<?php',
    'generated dependent',
    'generated dependency',
    'private-atomic-plugin-install-stack-v3',
  ];

  for (const mutation of groupMutations) {
    assert.equal(
      evidenceText.includes(JSON.stringify(mutation.value)),
      false,
      `${testCase.id} evidence leaked serialized mutation payload for ${mutation.resourceKey}`,
    );
    assert.equal(
      evidenceText.includes(JSON.stringify(deserializeResourceValue(mutation.value))),
      false,
      `${testCase.id} evidence leaked planned resource payload for ${mutation.resourceKey}`,
    );
  }
  for (const needle of forbiddenNeedles) {
    assert.equal(evidenceText.includes(needle), false, `${testCase.id} evidence leaked ${needle}`);
  }
}

function generatedAtomicBlockerCaseEvidence(testCase) {
  assert.equal(testCase.family, 'atomic-plugin-missing-dependency', `${testCase.id} family changed`);
  assert.equal(testCase.tags.has(stackTag), true, `${testCase.id} missing atomic stack v3 tag`);
  assert.equal(testCase.tags.has(missingDependencyTag), true, `${testCase.id} missing RPP-0260 v3 tag`);

  const validation = validateGeneratedCase(testCase);
  const plan = planFor(testCase);
  const group = plan.atomicGroups.find((entry) => entry.id === groupId);
  const refusal = assertNonReadyApplyRefusesBeforeMutation(testCase, plan);

  assert.ok(group, `${testCase.id} missing atomic group`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should be non-ready`);
  assert.equal(validation.status, plan.status, `${testCase.id} validation status`);
  assert.equal(validation.applied, false, `${testCase.id} validation applied`);
  assert.equal(validation.nonReadyRemoteUnchanged, true, `${testCase.id} validation remote preservation`);
  assert.equal(group.status, 'blocked', `${testCase.id} atomic group status`);
  assert.equal(group.requireAtomic, true, `${testCase.id} atomic group requireAtomic`);
  assert.deepEqual(
    [...group.resources].sort(),
    [dependentFileResourceKey, dependentPluginResourceKey].sort(),
    `${testCase.id} atomic group resources changed`,
  );
  assertPlanSummaryMatchesEvidence(plan, testCase.id);
  assertEveryMutationHasLiveRemotePrecondition(plan, testCase);

  const groupMutations = groupMutationsFor(plan, group, testCase);
  const directBlockers = group.blockers
    .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation')
    .sort((left, right) => left.id.localeCompare(right.id));
  const propagatedBlockers = group.blockers
    .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation');
  const propagatedByMutationId = new Map(
    propagatedBlockers.map((blocker) => [blocker.mutationId, blocker]),
  );
  const sourceBlockerIds = directBlockers.map((blocker) => blocker.id).sort();

  assert.equal(groupMutations.length, 2, `${testCase.id} grouped mutation count`);
  assert.deepEqual(
    groupMutations.map((mutation) => mutation.resourceKey).sort(),
    [dependentFileResourceKey, dependentPluginResourceKey].sort(),
    `${testCase.id} grouped mutation resources changed`,
  );
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === dependencyPluginResourceKey),
    false,
    `${testCase.id} should not synthesize a dependency plugin mutation`,
  );
  assert.equal(directBlockers.length, 1, `${testCase.id} source blocker count`);
  assert.equal(directBlockers[0].class, 'missing-plugin-dependency', `${testCase.id} source blocker class`);
  assert.equal(directBlockers[0].plugin, atomicDependencyPlugin, `${testCase.id} source blocker plugin`);
  assert.equal(group.dependencyRequirements.length, 1, `${testCase.id} dependency requirement count`);
  assert.equal(
    group.dependencyRequirements[0].plugin,
    atomicDependencyPlugin,
    `${testCase.id} dependency requirement plugin`,
  );
  assert.equal(
    group.dependencyRequirements[0].source,
    'missing-live-remote',
    `${testCase.id} dependency requirement source`,
  );
  assert.equal(
    group.dependencyRequirements[0].resourceKey,
    dependencyPluginResourceKey,
    `${testCase.id} dependency requirement resource key`,
  );
  assert.equal(
    propagatedBlockers.length,
    groupMutations.length,
    `${testCase.id} should propagate one blocker to every grouped mutation`,
  );

  for (const mutation of groupMutations) {
    assert.equal(mutation.atomicGroupId, group.id, `${testCase.id} mutation group id`);
    const propagated = propagatedByMutationId.get(mutation.id);
    assert.ok(propagated, `${testCase.id} missing propagated blocker for ${mutation.resourceKey}`);
    assert.equal(propagated.groupId, group.id, `${testCase.id} propagated group id`);
    assert.equal(propagated.resourceKey, mutation.resourceKey, `${testCase.id} propagated resource key`);
    assert.deepEqual(
      [...propagated.sourceBlockerIds].sort(),
      sourceBlockerIds,
      `${testCase.id} propagated source blocker ids`,
    );
  }

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variantTags: [stackTag, missingDependencyTag],
    status: plan.status,
    summary: plan.summary,
    validation: {
      status: validation.status,
      applied: validation.applied,
      nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged,
    },
    group: {
      id: group.id,
      kind: group.kind,
      status: group.status,
      resources: [...group.resources].sort(),
      mutationIds: [...group.mutationIds],
      dependencyRequirements: group.dependencyRequirements.map((requirement) => ({
        plugin: requirement.plugin,
        source: requirement.source,
        resourceKey: requirement.resourceKey,
        requirementHash: sha256Evidence(requirement),
      })),
      sourceBlockers: directBlockers.map((blocker) => ({
        id: blocker.id,
        class: blocker.class,
        groupId: blocker.groupId,
        plugin: blocker.plugin,
        blockerHash: sha256Evidence(blocker),
      })),
      propagatedBlockers: groupMutations.map((mutation) => {
        const blocker = propagatedByMutationId.get(mutation.id);
        return {
          id: blocker.id,
          class: blocker.class,
          groupId: blocker.groupId,
          mutationId: blocker.mutationId,
          resourceKey: blocker.resourceKey,
          sourceBlockerIds: [...blocker.sourceBlockerIds].sort(),
          blockerHash: sha256Evidence(blocker),
        };
      }),
    },
    groupedMutations: groupMutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      atomicGroupId: mutation.atomicGroupId,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      plannedResourceHash: sha256Evidence(deserializeResourceValue(mutation.value)),
    })),
    refusal,
  };
  const evidenceWithHash = {
    ...evidence,
    caseProofHash: sha256Evidence(evidence),
  };
  const evidenceText = JSON.stringify(evidenceWithHash);

  assertNoRawGeneratedValues(evidenceText, testCase, groupMutations);
  assert.deepEqual(findEvidenceRedactionIssues(evidenceWithHash), [], `${testCase.id} proof should be hash-only`);

  return evidenceWithHash;
}

function generatedAtomicBlockerVariant3Evidence() {
  return generatedAtomicBlockerVariant3Cases().map(generatedAtomicBlockerCaseEvidence);
}

function aggregateEvidence(caseEvidence, targetCoverage) {
  const aggregate = {
    totalCases: 0,
    totalBlockedGroups: 0,
    totalGroupMutations: 0,
    totalSourceBlockers: 0,
    totalPropagatedBlockers: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    statuses: {},
    perTier: {},
    sourceBlockerClasses: {},
    targetCoverage: {
      key: coverageKey,
      tag: stackTag,
      total: targetCoverage.total,
      statuses: targetCoverage.statuses,
      perTier: targetCoverage.perTier,
    },
  };

  for (const entry of caseEvidence) {
    aggregate.totalCases += 1;
    aggregate.totalBlockedGroups += 1;
    aggregate.totalGroupMutations += entry.groupedMutations.length;
    aggregate.totalSourceBlockers += entry.group.sourceBlockers.length;
    aggregate.totalPropagatedBlockers += entry.group.propagatedBlockers.length;
    aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
    aggregate.totalBeforeMutationCalls += entry.refusal.beforeMutationCalls;
    increment(aggregate.statuses, entry.status);
    increment(aggregate.perTier, entry.tier);
    for (const blocker of entry.group.sourceBlockers) {
      increment(aggregate.sourceBlockerClasses, blocker.class);
    }
  }

  return {
    ...aggregate,
    statuses: sortedStringObject(aggregate.statuses),
    perTier: sortedNumericObject(aggregate.perTier),
    sourceBlockerClasses: sortedStringObject(aggregate.sourceBlockerClasses),
  };
}

test('RPP-0260 generated atomic group blocker propagation variant 3 keeps grouped mutations blocked', () => {
  const report = runGeneratedPushHarness();
  const targetCoverage = report.summary.targetCoverage[coverageKey];

  assert.ok(targetCoverage, 'missing atomic plugin install stack v3 target coverage');
  assert.equal(targetCoverage.total, report.summary.featureFamilies[stackTag]);
  assert.equal(targetCoverage.total, 20);
  assert.deepEqual(targetCoverage.perTier, expectedPerTier(2));
  assert.deepEqual(targetCoverage.statuses, { blocked: 2, conflict: 8, ready: 10 });
  assert.equal(report.summary.featureFamilies[readyTag], 10);
  assert.equal(report.summary.featureFamilies[missingDependencyTag], 10);

  const firstEvidence = generatedAtomicBlockerVariant3Evidence();
  const replayEvidence = generatedAtomicBlockerVariant3Evidence();
  const aggregate = aggregateEvidence(firstEvidence, targetCoverage);
  const proof = {
    rpp: 'RPP-0260',
    behavior: 'generated atomic group blocker propagation variant 3',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    aggregate,
    selectedCases: firstEvidence.map((entry) => ({
      id: entry.id,
      tier: entry.tier,
      status: entry.status,
      groupStatus: entry.group.status,
      groupedMutationCount: entry.groupedMutations.length,
      sourceBlockerClasses: entry.group.sourceBlockers.map((blocker) => blocker.class),
      propagatedBlockerCount: entry.group.propagatedBlockers.length,
      refusalCode: entry.refusal.code,
      refusalDetailsHash: entry.refusal.detailsHash,
      caseProofHash: entry.caseProofHash,
    })),
  };
  const proofEnvelope = {
    command: 'node --test test/rpp-0260-atomic-group-blocker-propagation-v3.test.js',
    caveat: 'Generated local/model atomic blocker proof only; release remains gated separately.',
    proof,
    evidenceHash: sha256Evidence(firstEvidence),
  };
  const proofText = JSON.stringify(proofEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0260 generated evidence changed between runs');
  assert.equal(aggregate.totalCases, 10);
  assert.equal(aggregate.totalBlockedGroups, 10);
  assert.equal(aggregate.totalGroupMutations, 20);
  assert.equal(aggregate.totalSourceBlockers, 10);
  assert.equal(aggregate.totalPropagatedBlockers, aggregate.totalGroupMutations);
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalBeforeMutationCalls, 0);
  assert.deepEqual(aggregate.statuses, { blocked: 2, conflict: 8 });
  assert.deepEqual(aggregate.perTier, expectedPerTier(1));
  assert.deepEqual(aggregate.sourceBlockerClasses, { 'missing-plugin-dependency': 10 });
  assert.equal(
    proof.selectedCases.every((entry) =>
      entry.groupStatus === 'blocked'
      && entry.groupedMutationCount === 2
      && entry.propagatedBlockerCount === 2
      && entry.refusalCode === 'PLAN_NOT_READY'),
    true,
  );
  assert.match(proofEnvelope.evidenceHash, sha256EvidencePattern);
  assert.deepEqual(findEvidenceRedactionIssues(proofEnvelope), [], 'RPP-0260 proof should be hash-only');
  assert.equal(proofText.includes('<?php'), false);
  assert.equal(proofText.includes('generated dependent'), false);
  assert.equal(proofText.includes('generated dependency'), false);
  assert.equal(proofText.includes('private-atomic-plugin-install-stack-v3'), false);
});
