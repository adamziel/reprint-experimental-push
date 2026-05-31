import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0296-blocked-plan-apply-refusal-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const expectedGeneratedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

const activePluginsRowId = 'option_name:active_plugins';
const activePluginsResourceKey = rowKey('wp_options', activePluginsRowId);
const formsEntryRowId = 'entry_id:296';
const formsEntryResourceKey = rowKey('wp_forms_entries', formsEntryRowId);
const indexResourceKey = 'file:index.php';
const workingPostResourceKey = rowKey('wp_posts', 'ID:2');
const blockedAtomicGroupId = 'rpp-0296-blocked-atomic-group-release-verifier-v5';

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0296-index";',
  '<?php echo "local-private-rpp0296-active-file";',
  '<?php echo "local-private-rpp0296-plugin-owned-file";',
  '<?php echo "local-private-rpp0296-atomic-file";',
  'analytics/analytics.php',
  'base-private-rpp0296-entry',
  'local-private-rpp0296-entry-blocked',
  'local-private-rpp0296-entry-atomic-blocked',
  'Base private RPP-0296 working post',
  'Local private RPP-0296 atomic post',
]);

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

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
      'index.php': '<?php echo "base-private-rpp0296-index";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0296 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsEntryRowId]: {
          entry_id: 296,
          status: 'submitted',
          payload: {
            mode: 'base-private-rpp0296-entry',
            ordinal: 1,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_options: {
        [activePluginsRowId]: {
          option_name: 'active_plugins',
          option_value: ['forms/forms.php'],
        },
        'option_name:blogname': {
          option_name: 'blogname',
          option_value: 'RPP 0296 Base',
        },
      },
      wp_posts: {
        'ID:2': {
          ID: 2,
          post_title: 'Base private RPP-0296 working post',
          post_status: 'publish',
        },
      },
    },
  };
}

function activePluginsFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0296-active-file";';
  local.db.wp_options[activePluginsRowId].option_value = [
    'forms/forms.php',
    'analytics/analytics.php',
  ];

  return {
    label: 'RPP-0296 focused active_plugins blocker beside safe file mutation',
    base,
    local,
    remote,
    expectedSummary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 1,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedBlockers: [
      {
        resourceKey: activePluginsResourceKey,
        class: 'unsupported-active-plugins-direct-mutation',
        groupId: null,
      },
    ],
    expectedAtomicGroups: [],
  };
}

function unsupportedPluginOwnedFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0296-plugin-owned-file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0296-entry-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 2;

  return {
    label: 'RPP-0296 focused unsupported plugin-owned blocker beside safe file mutation',
    base,
    local,
    remote,
    expectedSummary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 1,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedBlockers: [
      {
        resourceKey: formsEntryResourceKey,
        class: 'unsupported-plugin-owned-resource',
        groupId: null,
      },
    ],
    expectedAtomicGroups: [],
  };
}

function atomicPropagationFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0296-atomic-file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0296-entry-atomic-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 3;
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0296 atomic post';
  local.pushIntents = [
    {
      id: blockedAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, workingPostResourceKey, formsEntryResourceKey],
    },
  ];

  return {
    label: 'RPP-0296 focused atomic blocker propagation before safe mutations apply',
    base,
    local,
    remote,
    expectedSummary: {
      mutations: 2,
      decisions: 0,
      conflicts: 0,
      blockers: 3,
      atomicGroups: 1,
    },
    expectedMutationResourceKeys: [indexResourceKey, workingPostResourceKey],
    expectedBlockers: [
      {
        resourceKey: formsEntryResourceKey,
        class: 'unsupported-plugin-owned-resource',
        groupId: null,
      },
      {
        resourceKey: indexResourceKey,
        class: 'atomic-group-blocker-propagation',
        groupId: blockedAtomicGroupId,
      },
      {
        resourceKey: workingPostResourceKey,
        class: 'atomic-group-blocker-propagation',
        groupId: blockedAtomicGroupId,
      },
    ],
    expectedAtomicGroups: [
      {
        id: blockedAtomicGroupId,
        status: 'blocked',
        mutationResourceKeys: [indexResourceKey, workingPostResourceKey],
        blockerClasses: [
          'atomic-group-blocker-propagation',
          'atomic-group-blocker-propagation',
          'unsupported-plugin-owned-resource',
        ],
      },
    ],
  };
}

function focusedFixtures() {
  return [
    activePluginsFixture(),
    unsupportedPluginOwnedFixture(),
    atomicPropagationFixture(),
  ];
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function sortStrings(values) {
  return [...values].sort();
}

function sortedObject(object, compare = ([left], [right]) => left.localeCompare(right)) {
  return Object.fromEntries(Object.entries(object).sort(compare));
}

function sortedNumericObject(object) {
  return sortedObject(object, ([left], [right]) => Number(left) - Number(right));
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
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

function blockerShape(blocker) {
  return {
    resourceKey: blocker.resourceKey || null,
    class: blocker.class,
    groupId: blocker.groupId || null,
  };
}

function sortedBlockerShape(blockers) {
  return blockers
    .map(blockerShape)
    .sort((left, right) =>
      `${left.class}:${left.resourceKey}:${left.groupId}`
        .localeCompare(`${right.class}:${right.resourceKey}:${right.groupId}`));
}

function assertSha256Hex(value, label) {
  assert.match(value, sha256HexPattern, label);
}

function assertPlanSurface(plan, fixture) {
  assert.equal(plan.status, 'blocked', `${fixture.label} status`);
  assert.deepEqual(plan.summary, fixture.expectedSummary, `${fixture.label} summary`);
  assert.deepEqual(plan.summary, emittedPlannerCounts(plan), `${fixture.label} emitted summary counts`);
  assert.deepEqual(
    sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} mutation surface`,
  );
  assert.deepEqual(
    sortStrings(plan.preconditions.map((precondition) => precondition.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} precondition surface`,
  );
  assert.deepEqual(plan.conflicts, [], `${fixture.label} conflict evidence`);
  assert.deepEqual(
    sortedBlockerShape(plan.blockers),
    sortedBlockerShape(fixture.expectedBlockers),
    `${fixture.label} blocker surface`,
  );

  for (const expectedGroup of fixture.expectedAtomicGroups) {
    const group = plan.atomicGroups.find((candidate) => candidate.id === expectedGroup.id);
    assert.ok(group, `${fixture.label} missing atomic group ${expectedGroup.id}`);
    const groupedMutationResourceKeys = group.mutationIds.map((mutationId) => {
      const mutation = plan.mutations.find((candidate) => candidate.id === mutationId);
      assert.ok(mutation, `${fixture.label} missing grouped mutation ${mutationId}`);
      return mutation.resourceKey;
    });

    assert.equal(group.status, expectedGroup.status, `${fixture.label} atomic group status`);
    assert.deepEqual(
      sortStrings(groupedMutationResourceKeys),
      sortStrings(expectedGroup.mutationResourceKeys),
      `${fixture.label} atomic group mutation resources`,
    );
    assert.deepEqual(
      sortStrings(group.blockers.map((blocker) => blocker.class)),
      sortStrings(expectedGroup.blockerClasses),
      `${fixture.label} atomic group blocker classes`,
    );
  }
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${label} mutation resource key mismatch`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource object mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      mutation.remoteBeforeHash,
      resourceHash(remote, mutation.resource),
      `${label} remoteBeforeHash must bind to the dry-run remote`,
    );
    assertSha256Hex(mutation.baseHash, `${label} mutation ${mutation.resourceKey} baseHash`);
    assertSha256Hex(mutation.localHash, `${label} mutation ${mutation.resourceKey} localHash`);
    assertSha256Hex(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remoteBeforeHash`);
  }
}

function assertBlockedApplyRefusesBeforeMutation({ plan, remote, label }) {
  const applyRemote = cloneJson(remote);
  const beforeRemoteJson = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  let returnedResult = null;
  const error = captureError(() => {
    returnedResult = applyPlan(applyRemote, plan, {
      mutateRemote: true,
      durableJournal: durableJournal(journalEvents),
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  });

  assert.ok(error instanceof PushPlanError, `${label} should throw PushPlanError`);
  assert.deepEqual(
    {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    {
      code: 'PLAN_NOT_READY',
      message: 'Refusing to apply a blocked plan.',
      details: { status: 'blocked' },
    },
    `${label} refusal envelope changed`,
  );
  assert.equal(returnedResult, null, `${label} returned an apply result`);
  assert.equal(beforeMutationCalls, 0, `${label} reached the mutation callback`);
  assert.equal(JSON.stringify(applyRemote), beforeRemoteJson, `${label} mutated the remote snapshot`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${label} changed the remote snapshot hash`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal evidence before refusal`);

  return {
    code: error.code,
    status: error.details.status,
    detailsHash: sha256Evidence(error.details),
    beforeRemoteHash: `sha256:${beforeRemoteHash}`,
    afterRemoteHash: `sha256:${digest(applyRemote)}`,
    remotePreserved: digest(applyRemote) === beforeRemoteHash,
    beforeMutationCalls,
    durableJournalEventCount: journalEvents.length,
    appliedMutationCount: 0,
    preMutationRefusal: true,
  };
}

function mutationEvidence(mutation) {
  return {
    mutationIdHash: sha256Evidence(mutation.id),
    resourceKey: mutation.resourceKey,
    resourceType: mutation.resource.type,
    action: mutation.action,
    changeKind: mutation.changeKind,
    atomicGroupIdHash: mutation.atomicGroupId ? sha256Evidence(mutation.atomicGroupId) : null,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    mutationHash: sha256Evidence(mutation),
  };
}

function preconditionEvidence(precondition) {
  return {
    mutationIdHash: sha256Evidence(precondition.mutationId),
    resourceKey: precondition.resourceKey,
    expectedHash: precondition.expectedHash,
    checkedAgainst: precondition.checkedAgainst,
    preconditionHash: sha256Evidence(precondition),
  };
}

function blockerEvidence(blocker) {
  return {
    resourceKey: blocker.resourceKey || null,
    class: blocker.class,
    reasonCode: blocker.reasonCode || null,
    requiredDriver: blocker.requiredDriver || null,
    pluginOwner: blocker.pluginOwner || null,
    driver: blocker.driver || null,
    groupIdHash: blocker.groupId ? sha256Evidence(blocker.groupId) : null,
    blockerHash: sha256Evidence(blocker),
  };
}

function atomicGroupEvidence(group) {
  return {
    idHash: sha256Evidence(group.id),
    status: group.status,
    mutationIdHashes: group.mutationIds.map(sha256Evidence).sort(),
    blockerHashes: group.blockers.map(sha256Evidence).sort(),
    groupHash: sha256Evidence(group),
  };
}

function hashOnlyPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    planHash: sha256Evidence(plan),
    mutationResourceKeys: sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    preconditionResourceKeys: sortStrings(plan.preconditions.map((precondition) => precondition.resourceKey)),
    blockerResourceKeys: sortStrings(plan.blockers.map((blocker) => blocker.resourceKey || '')),
    blockerClasses: sortStrings(plan.blockers.map((blocker) => blocker.class)),
    blockerReasonCodes: sortStrings(plan.blockers.map((blocker) => blocker.reasonCode).filter(Boolean)),
    mutationEvidence: plan.mutations.map(mutationEvidence),
    preconditionEvidence: plan.preconditions.map(preconditionEvidence),
    blockerEvidence: plan.blockers.map(blockerEvidence),
    atomicGroupEvidence: plan.atomicGroups.map(atomicGroupEvidence),
  };
}

function focusedBlockedPlanApplyRefusalEvidence() {
  return focusedFixtures().map((fixture) => {
    const firstPlan = planFor(fixture);
    const replayPlan = planFor({
      base: cloneJson(fixture.base),
      local: cloneJson(fixture.local),
      remote: cloneJson(fixture.remote),
    });
    const firstPlanEvidence = hashOnlyPlanEvidence(firstPlan);
    const replayPlanEvidence = hashOnlyPlanEvidence(replayPlan);

    assertPlanSurface(firstPlan, fixture);
    assertPlanSurface(replayPlan, fixture);
    assertEveryMutationHasLiveRemotePrecondition(firstPlan, fixture.remote, fixture.label);
    assertEveryMutationHasLiveRemotePrecondition(replayPlan, fixture.remote, `${fixture.label} replay`);
    assert.deepEqual(
      firstPlanEvidence,
      replayPlanEvidence,
      `${fixture.label} blocked release-verifier evidence changed between deterministic planning runs`,
    );

    return {
      label: fixture.label,
      plan: firstPlanEvidence,
      refusal: assertBlockedApplyRefusesBeforeMutation({
        plan: firstPlan,
        remote: fixture.remote,
        label: fixture.label,
      }),
    };
  });
}

function generatedBlockedPlanApplyRefusalEvidence() {
  const cases = generatePushHarnessCases();
  const blockedCases = [];

  assert.equal(cases.length, DEFAULT_GENERATED_PUSH_CASES);

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });

    if (plan.status !== 'blocked') {
      continue;
    }

    const replayPlan = createPushPlan({
      base: cloneJson(testCase.base),
      local: cloneJson(testCase.local),
      remote: cloneJson(testCase.remote),
      now: fixedNow,
    });
    const firstPlanEvidence = hashOnlyPlanEvidence(plan);
    const replayPlanEvidence = hashOnlyPlanEvidence(replayPlan);
    const refusal = assertBlockedApplyRefusesBeforeMutation({
      plan,
      remote: testCase.remote,
      label: testCase.id,
    });

    assert.deepEqual(
      firstPlanEvidence,
      replayPlanEvidence,
      `${testCase.id} generated blocked evidence changed between deterministic planning runs`,
    );
    assert.deepEqual(plan.summary, emittedPlannerCounts(plan), `${testCase.id} emitted summary counts`);
    assert.equal(plan.conflicts.length, 0, `${testCase.id} blocked plan must not carry conflicts`);
    assert.ok(plan.blockers.length > 0, `${testCase.id} blocked plan must carry blocker evidence`);
    assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

    blockedCases.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      summary: plan.summary,
      planHash: firstPlanEvidence.planHash,
      plannedMutations: plan.mutations.length,
      plannedPreconditions: plan.preconditions.length,
      blockerClasses: firstPlanEvidence.blockerClasses,
      blockerReasonCodes: firstPlanEvidence.blockerReasonCodes,
      blockerEvidenceHash: sha256Evidence(firstPlanEvidence.blockerEvidence),
      mutationEvidenceHash: sha256Evidence(firstPlanEvidence.mutationEvidence),
      preconditionEvidenceHash: sha256Evidence(firstPlanEvidence.preconditionEvidence),
      atomicGroupEvidenceHash: sha256Evidence(firstPlanEvidence.atomicGroupEvidence),
      refusal,
    });
  }

  return {
    totalHarnessCases: cases.length,
    blockedCases,
  };
}

function aggregateFocusedEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    totalMutations: 0,
    totalPreconditions: 0,
    totalBlockers: 0,
    totalAtomicGroups: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    preMutationRefusals: 0,
    remotePreserved: 0,
    blockerClasses: {},
    refusalCodes: {},
  };

  for (const entry of evidence) {
    increment(aggregate.statuses, entry.plan.status);
    aggregate.totalMutations += entry.plan.summary.mutations;
    aggregate.totalPreconditions += entry.plan.preconditionResourceKeys.length;
    aggregate.totalBlockers += entry.plan.summary.blockers;
    aggregate.totalAtomicGroups += entry.plan.summary.atomicGroups;
    aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
    aggregate.totalBeforeMutationCalls += entry.refusal.beforeMutationCalls;
    aggregate.preMutationRefusals += entry.refusal.preMutationRefusal ? 1 : 0;
    aggregate.remotePreserved += entry.refusal.remotePreserved ? 1 : 0;
    increment(aggregate.refusalCodes, entry.refusal.code);
    for (const blockerClass of entry.plan.blockerClasses) {
      increment(aggregate.blockerClasses, blockerClass);
    }
  }

  return {
    ...aggregate,
    statuses: sortedObject(aggregate.statuses),
    blockerClasses: sortedObject(aggregate.blockerClasses),
    refusalCodes: sortedObject(aggregate.refusalCodes),
  };
}

function aggregateGeneratedEvidence(evidence) {
  const aggregate = {
    totalHarnessCases: evidence.totalHarnessCases,
    totalBlockedCases: evidence.blockedCases.length,
    blockedCasesWithMutations: 0,
    totalPlannedMutations: 0,
    totalPlannedPreconditions: 0,
    totalBlockers: 0,
    totalAtomicGroups: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    preMutationRefusals: 0,
    remotePreserved: 0,
    perTier: {},
    families: {},
    blockerClasses: {},
    refusalCodes: {},
  };

  for (const entry of evidence.blockedCases) {
    if (entry.plannedMutations > 0) {
      aggregate.blockedCasesWithMutations += 1;
    }
    aggregate.totalPlannedMutations += entry.plannedMutations;
    aggregate.totalPlannedPreconditions += entry.plannedPreconditions;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalAtomicGroups += entry.summary.atomicGroups;
    aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
    aggregate.totalBeforeMutationCalls += entry.refusal.beforeMutationCalls;
    aggregate.preMutationRefusals += entry.refusal.preMutationRefusal ? 1 : 0;
    aggregate.remotePreserved += entry.refusal.remotePreserved ? 1 : 0;
    increment(aggregate.perTier, entry.tier);
    increment(aggregate.families, entry.family);
    increment(aggregate.refusalCodes, entry.refusal.code);
    for (const blockerClass of entry.blockerClasses) {
      increment(aggregate.blockerClasses, blockerClass);
    }
  }

  return {
    ...aggregate,
    perTier: sortedNumericObject(aggregate.perTier),
    families: sortedObject(aggregate.families),
    blockerClasses: sortedObject(aggregate.blockerClasses),
    refusalCodes: sortedObject(aggregate.refusalCodes),
  };
}

function assertFocusedAggregate(aggregate) {
  assert.deepEqual(aggregate, {
    totalCases: 3,
    statuses: {
      blocked: 3,
    },
    totalMutations: 4,
    totalPreconditions: 4,
    totalBlockers: 5,
    totalAtomicGroups: 1,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    preMutationRefusals: 3,
    remotePreserved: 3,
    blockerClasses: {
      'atomic-group-blocker-propagation': 2,
      'unsupported-active-plugins-direct-mutation': 1,
      'unsupported-plugin-owned-resource': 2,
    },
    refusalCodes: {
      PLAN_NOT_READY: 3,
    },
  });
}

function assertGeneratedAggregate(aggregate) {
  assert.equal(aggregate.totalHarnessCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(aggregate.totalBlockedCases > 0, 'generated harness must include blocked cases');
  assert.ok(aggregate.blockedCasesWithMutations > 0, 'generated blocked proof must include safe planned mutations');
  assert.ok(Object.keys(aggregate.families).length > 1, 'generated proof must cover multiple blocked families');
  assert.deepEqual(Object.keys(aggregate.perTier).map(Number), expectedGeneratedTiers);
  assert.equal(aggregate.totalPlannedMutations, aggregate.totalPlannedPreconditions);
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalBeforeMutationCalls, 0);
  assert.equal(aggregate.preMutationRefusals, aggregate.totalBlockedCases);
  assert.equal(aggregate.remotePreserved, aggregate.totalBlockedCases);
  assert.equal(aggregate.refusalCodes.PLAN_NOT_READY, aggregate.totalBlockedCases);
  assert.ok(aggregate.blockerClasses['unsupported-plugin-owned-resource'] > 0);
  assert.ok(aggregate.blockerClasses['stale-wordpress-graph-identity'] > 0);
  assert.ok(aggregate.blockerClasses['atomic-group-blocker-propagation'] > 0);
}

function assertEvidenceHashes(value) {
  const serialized = JSON.stringify(value);
  const evidenceHashes = serialized.match(/sha256:[a-f0-9]{64}/g) || [];
  const bareHashes = serialized.match(/(?<!sha256:)[a-f0-9]{64}/g) || [];

  assert.ok(evidenceHashes.length > 0, 'release verifier proof should include sha256 evidence hashes');
  for (const evidenceHash of evidenceHashes) {
    assert.match(evidenceHash, sha256EvidencePattern);
  }
  for (const bareHash of bareHashes) {
    assert.match(bareHash, sha256HexPattern);
  }
}

function assertHashOnlyEvidence(value, label) {
  const serialized = JSON.stringify(value);

  for (const rawValue of rawFixtureValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked raw fixture value ${rawValue}`);
  }
  for (const rawMarker of [
    'base-private',
    'local-private',
    'remote-private',
    '<?php',
    'payload',
    'post_title',
    'option_value',
    '__pluginOwner',
    'analytics/analytics.php',
  ]) {
    assert.equal(serialized.includes(rawMarker), false, `${label} leaked raw marker ${rawMarker}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
  assertEvidenceHashes(value);
}

test('RPP-0296 release verifier v5 carries blocked plan apply refusal through focused and generated fixtures', () => {
  const firstFocusedEvidence = focusedBlockedPlanApplyRefusalEvidence();
  const replayFocusedEvidence = focusedBlockedPlanApplyRefusalEvidence();
  const firstGeneratedEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const replayGeneratedEvidence = generatedBlockedPlanApplyRefusalEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const generatedAggregate = aggregateGeneratedEvidence(firstGeneratedEvidence);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0296',
    evidenceSource: 'blocked-plan-apply-refusal-release-verifier-v5',
    status: 'support_only',
    evidenceScope: 'local-release-verifier',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    invariant: 'blocked plans reject with PLAN_NOT_READY before mutation callbacks, durable journal events, or remote changes',
    focused: focusedAggregate,
    generated: {
      totalHarnessCases: generatedAggregate.totalHarnessCases,
      totalBlockedCases: generatedAggregate.totalBlockedCases,
      blockedCasesWithMutations: generatedAggregate.blockedCasesWithMutations,
      totalPlannedMutations: generatedAggregate.totalPlannedMutations,
      totalPlannedPreconditions: generatedAggregate.totalPlannedPreconditions,
      totalBlockers: generatedAggregate.totalBlockers,
      totalAtomicGroups: generatedAggregate.totalAtomicGroups,
      familyCount: Object.keys(generatedAggregate.families).length,
      blockerClasses: generatedAggregate.blockerClasses,
      refusalCodes: generatedAggregate.refusalCodes,
      totalAppliedMutations: generatedAggregate.totalAppliedMutations,
      totalDurableJournalEvents: generatedAggregate.totalDurableJournalEvents,
      totalBeforeMutationCalls: generatedAggregate.totalBeforeMutationCalls,
      preMutationRefusals: generatedAggregate.preMutationRefusals,
      remotePreserved: generatedAggregate.remotePreserved,
    },
    focusedHash: sha256Evidence(firstFocusedEvidence),
    generatedHash: sha256Evidence(firstGeneratedEvidence),
    aggregateHash: sha256Evidence({ focusedAggregate, generatedAggregate }),
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0296 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0296 generated release-verifier evidence changed between runs',
  );
  assertFocusedAggregate(focusedAggregate);
  assertGeneratedAggregate(generatedAggregate);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence, 'RPP-0296 focused release-verifier evidence');
  assertHashOnlyEvidence(firstGeneratedEvidence, 'RPP-0296 generated release-verifier evidence');
  assertHashOnlyEvidence(releaseEvidenceEnvelope, 'RPP-0296 release-verifier envelope');
});
