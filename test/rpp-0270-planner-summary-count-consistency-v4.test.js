import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const command = 'node --test test/rpp-0270-planner-summary-count-consistency-v4.test.js';
const caveat = 'Local deterministic Node focused planner proof; release remains gated separately.';

const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsEntryRowId = 'entry_id:270';
const formsEntryResourceKey = 'row:["wp_forms_entries","entry_id:270"]';
const indexResourceKey = 'file:index.php';
const atomicReadyFilePath = 'wp-content/uploads/rpp-0270-ready-atomic.txt';
const atomicReadyFileResourceKey = `file:${atomicReadyFilePath}`;
const decisionPostResourceKey = 'row:["wp_posts","ID:1"]';
const conflictPostResourceKey = 'row:["wp_posts","ID:2"]';
const readyAtomicGroupId = 'rpp-0270-ready-atomic-group-v4';
const blockedAtomicGroupId = 'rpp-0270-blocked-atomic-group-v4';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base rpp0270";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0270 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsEntryRowId]: {
          entry_id: 270,
          status: 'submitted',
          payload: {
            mode: 'base',
            ordinal: 1,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: 'base',
            limit: 10,
          },
          autoload: 'no',
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base RPP-0270 decision post',
          post_status: 'publish',
        },
        'ID:2': {
          ID: 2,
          post_title: 'Base RPP-0270 working post',
          post_status: 'publish',
        },
      },
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option') {
  return { resourceKey, pluginOwner, driver };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
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

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function assertPlannerSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    emittedPlannerCounts(plan),
    `${label} summary must match emitted planner evidence counts`,
  );
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${label} status must match emitted conflicts/blockers`,
  );
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} preconditions must stay one-for-one with emitted mutations`,
  );
}

function plannerSummaryEvidenceEnvelope(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    emitted: emittedPlannerCounts(plan),
    preconditions: plan.preconditions.map((precondition) => [
      precondition.mutationId,
      precondition.resourceKey,
      precondition.expectedHash,
    ]),
    mutations: plan.mutations.map((mutation) => [
      mutation.id,
      mutation.resourceKey,
      mutation.action,
      mutation.atomicGroupId,
    ]),
    decisions: plan.decisions.map((decision) => [
      decision.id,
      decision.resourceKey,
      decision.decision,
    ]),
    conflicts: plan.conflicts.map((conflict) => [
      conflict.id,
      conflict.resourceKey,
      conflict.class,
    ]),
    blockers: plan.blockers.map((blocker) => [
      blocker.id,
      blocker.resourceKey || null,
      blocker.class,
      blocker.groupId || null,
    ]),
    atomicGroups: plan.atomicGroups.map((group) => [
      group.id,
      group.status,
      [...group.mutationIds],
      [...group.conflicts],
      group.blockers.map((blocker) => blocker.id),
    ]),
  };
}

function readyMixedDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0270 ready file";';
  local.db.wp_options[formsOptionRowId].option_value.mode = 'local-ready-rpp0270';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms'),
    ),
  };
  remote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0270 keep-remote decision';

  return {
    label: 'RPP-0270 ready mixed mutation and decision fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedSummary: {
      mutations: 2,
      decisions: 1,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey, formsOptionResourceKey],
    expectedDecisionResourceKeys: [decisionPostResourceKey],
    expectedConflictResourceKeys: [],
    expectedBlockers: [],
    expectedAtomicGroups: [],
  };
}

function conflictWithSafeMutationAndDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0270 conflict-safe file";';
  local.db.wp_posts['ID:2'].post_title = 'Local RPP-0270 conflicting post title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0270 decision beside conflict';
  remote.db.wp_posts['ID:2'].post_title = 'Remote RPP-0270 conflicting post title';

  return {
    label: 'RPP-0270 conflict with safe mutation and decision fixture',
    base,
    local,
    remote,
    expectedStatus: 'conflict',
    expectedSummary: {
      mutations: 1,
      decisions: 1,
      conflicts: 1,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedDecisionResourceKeys: [decisionPostResourceKey],
    expectedConflictResourceKeys: [conflictPostResourceKey],
    expectedBlockers: [],
    expectedAtomicGroups: [],
  };
}

function blockedWithSafeMutationAndDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0270 blocked-safe file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-blocked-rpp0270';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 2;
  remote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0270 decision beside blocker';

  return {
    label: 'RPP-0270 blocked with safe mutation and decision fixture',
    base,
    local,
    remote,
    expectedStatus: 'blocked',
    expectedSummary: {
      mutations: 1,
      decisions: 1,
      conflicts: 0,
      blockers: 1,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [indexResourceKey],
    expectedDecisionResourceKeys: [decisionPostResourceKey],
    expectedConflictResourceKeys: [],
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

function readyAtomicGroupFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0270 ready atomic index";';
  local.files[atomicReadyFilePath] = 'local rpp0270 ready atomic create';
  local.pushIntents = [
    {
      id: readyAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, atomicReadyFileResourceKey],
    },
  ];
  remote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0270 ready atomic decision';

  return {
    label: 'RPP-0270 ready atomic group fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedSummary: {
      mutations: 2,
      decisions: 1,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 1,
    },
    expectedMutationResourceKeys: [indexResourceKey, atomicReadyFileResourceKey],
    expectedDecisionResourceKeys: [decisionPostResourceKey],
    expectedConflictResourceKeys: [],
    expectedBlockers: [],
    expectedAtomicGroups: [
      {
        id: readyAtomicGroupId,
        status: 'ready',
        mutationResourceKeys: [indexResourceKey, atomicReadyFileResourceKey],
        blockerClasses: [],
      },
    ],
  };
}

function blockedAtomicPropagationFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0270 blocked atomic index";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-atomic-blocked-rpp0270';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 3;
  local.db.wp_posts['ID:2'].post_title = 'Local RPP-0270 blocked atomic post';
  local.pushIntents = [
    {
      id: blockedAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, conflictPostResourceKey, formsEntryResourceKey],
    },
  ];

  return {
    label: 'RPP-0270 blocked atomic propagation fixture',
    base,
    local,
    remote,
    expectedStatus: 'blocked',
    expectedSummary: {
      mutations: 2,
      decisions: 0,
      conflicts: 0,
      blockers: 3,
      atomicGroups: 1,
    },
    expectedMutationResourceKeys: [indexResourceKey, conflictPostResourceKey],
    expectedDecisionResourceKeys: [],
    expectedConflictResourceKeys: [],
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
        resourceKey: conflictPostResourceKey,
        class: 'atomic-group-blocker-propagation',
        groupId: blockedAtomicGroupId,
      },
    ],
    expectedAtomicGroups: [
      {
        id: blockedAtomicGroupId,
        status: 'blocked',
        mutationResourceKeys: [indexResourceKey, conflictPostResourceKey],
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
    readyMixedDecisionFixture(),
    conflictWithSafeMutationAndDecisionFixture(),
    blockedWithSafeMutationAndDecisionFixture(),
    readyAtomicGroupFixture(),
    blockedAtomicPropagationFixture(),
  ];
}

function sortStrings(values) {
  return [...values].sort();
}

function sortedBlockerShape(blockers) {
  return blockers
    .map((blocker) => ({
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
      groupId: blocker.groupId || null,
    }))
    .sort((left, right) =>
      `${left.class}:${left.resourceKey}:${left.groupId}`
        .localeCompare(`${right.class}:${right.resourceKey}:${right.groupId}`));
}

function assertPlanSurface(plan, fixture) {
  assert.equal(plan.status, fixture.expectedStatus, `${fixture.label} status`);
  assert.deepEqual(plan.summary, fixture.expectedSummary, `${fixture.label} summary`);
  assert.deepEqual(
    sortStrings(plan.mutations.map((mutation) => mutation.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} mutation resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.preconditions.map((precondition) => precondition.resourceKey)),
    sortStrings(fixture.expectedMutationResourceKeys),
    `${fixture.label} precondition resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.decisions.map((decision) => decision.resourceKey)),
    sortStrings(fixture.expectedDecisionResourceKeys),
    `${fixture.label} decision resource surface`,
  );
  assert.deepEqual(
    sortStrings(plan.conflicts.map((conflict) => conflict.resourceKey)),
    sortStrings(fixture.expectedConflictResourceKeys),
    `${fixture.label} conflict resource surface`,
  );
  assert.deepEqual(
    sortedBlockerShape(plan.blockers),
    sortedBlockerShape(fixture.expectedBlockers),
    `${fixture.label} blocker surface`,
  );
  assert.equal(
    plan.preconditions.every((precondition) => precondition.checkedAgainst === 'live-remote'),
    true,
    `${fixture.label} preconditions should bind to live remote`,
  );

  for (const expectedGroup of fixture.expectedAtomicGroups) {
    const group = plan.atomicGroups.find((candidate) => candidate.id === expectedGroup.id);
    assert.ok(group, `${fixture.label} missing atomic group ${expectedGroup.id}`);
    const mutationResourceKeys = group.mutationIds.map((mutationId) => {
      const mutation = plan.mutations.find((candidate) => candidate.id === mutationId);
      assert.ok(mutation, `${fixture.label} missing grouped mutation ${mutationId}`);
      return mutation.resourceKey;
    });
    assert.equal(group.status, expectedGroup.status, `${fixture.label} atomic group status`);
    assert.deepEqual(
      sortStrings(mutationResourceKeys),
      sortStrings(expectedGroup.mutationResourceKeys),
      `${fixture.label} atomic group mutation surface`,
    );
    assert.deepEqual(
      sortStrings(group.blockers.map((blocker) => blocker.class)),
      sortStrings(expectedGroup.blockerClasses),
      `${fixture.label} atomic group blocker classes`,
    );
  }
}

function focusedPlannerSummaryEvidence() {
  return focusedFixtures().map((fixture) => {
    const firstPlan = planFor(fixture);
    const replayPlan = planFor({
      base: cloneJson(fixture.base),
      local: cloneJson(fixture.local),
      remote: cloneJson(fixture.remote),
    });

    assertPlannerSummaryMatchesEvidence(firstPlan, fixture.label);
    assertPlannerSummaryMatchesEvidence(replayPlan, `${fixture.label} replay`);
    assertPlanSurface(firstPlan, fixture);
    assert.deepEqual(
      plannerSummaryEvidenceEnvelope(firstPlan),
      plannerSummaryEvidenceEnvelope(replayPlan),
      `${fixture.label} summary evidence changed between deterministic planning runs`,
    );

    return {
      label: fixture.label,
      status: firstPlan.status,
      summary: firstPlan.summary,
      emitted: emittedPlannerCounts(firstPlan),
      preconditions: firstPlan.preconditions.length,
      mutationResourceKeys: sortStrings(firstPlan.mutations.map((mutation) => mutation.resourceKey)),
      decisionResourceKeys: sortStrings(firstPlan.decisions.map((decision) => decision.resourceKey)),
      conflictResourceKeys: sortStrings(firstPlan.conflicts.map((conflict) => conflict.resourceKey)),
      blockerClasses: sortStrings(firstPlan.blockers.map((blocker) => blocker.class)),
      atomicGroupStatuses: firstPlan.atomicGroups.map((group) => [group.id, group.status]),
    };
  });
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function aggregateFocusedPlannerEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    totalMutations: 0,
    totalDecisions: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalAtomicGroups: 0,
    totalPreconditions: 0,
  };

  for (const entry of evidence) {
    incrementCount(aggregate.statuses, entry.status);
    aggregate.totalMutations += entry.summary.mutations;
    aggregate.totalDecisions += entry.summary.decisions;
    aggregate.totalConflicts += entry.summary.conflicts;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalAtomicGroups += entry.summary.atomicGroups;
    aggregate.totalPreconditions += entry.preconditions;
  }

  return {
    ...aggregate,
    statuses: sortedObject(aggregate.statuses),
  };
}

test('RPP-0270 planner summary counts match focused emitted evidence deterministically', () => {
  const firstEvidence = focusedPlannerSummaryEvidence();
  const replayEvidence = focusedPlannerSummaryEvidence();
  const aggregate = aggregateFocusedPlannerEvidence(firstEvidence);
  const evidenceEnvelope = {
    command,
    caveat,
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };

  assert.deepEqual(firstEvidence, replayEvidence, 'focused planner summary evidence changed between runs');
  assert.deepEqual(aggregate, {
    totalCases: 5,
    statuses: {
      blocked: 2,
      conflict: 1,
      ready: 2,
    },
    totalMutations: 8,
    totalDecisions: 4,
    totalConflicts: 1,
    totalBlockers: 4,
    totalAtomicGroups: 2,
    totalPreconditions: 8,
  });
  assert.equal(aggregate.totalPreconditions, aggregate.totalMutations);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidenceEnvelope).includes('confidential'), false);
});
