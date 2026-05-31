import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0290-planner-summary-count-consistency-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsEntryRowId = 'entry_id:290';
const formsEntryResourceKey = 'row:["wp_forms_entries","entry_id:290"]';
const indexResourceKey = 'file:index.php';
const atomicReadyFilePath = 'wp-content/uploads/rpp-0290-ready-atomic.txt';
const atomicReadyFileResourceKey = `file:${atomicReadyFilePath}`;
const decisionPostResourceKey = 'row:["wp_posts","ID:1"]';
const conflictPostResourceKey = 'row:["wp_posts","ID:2"]';
const readyAtomicGroupId = 'rpp-0290-ready-atomic-group-release-verifier-v5';
const blockedAtomicGroupId = 'rpp-0290-blocked-atomic-group-release-verifier-v5';

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0290";',
  '<?php echo "local-private-rpp0290-ready-file";',
  '<?php echo "local-private-rpp0290-conflict-safe-file";',
  '<?php echo "local-private-rpp0290-blocked-safe-file";',
  '<?php echo "local-private-rpp0290-ready-atomic-index";',
  '<?php echo "local-private-rpp0290-blocked-atomic-index";',
  'local-private-rpp0290-ready-atomic-create',
  'local-private-rpp0290-option-mode',
  'local-private-rpp0290-entry-blocked',
  'local-private-rpp0290-entry-atomic-blocked',
  'Local private RPP-0290 conflicting post title',
  'Remote private RPP-0290 conflicting post title',
  'Remote private RPP-0290 keep-remote decision',
  'Remote private RPP-0290 decision beside conflict',
  'Remote private RPP-0290 decision beside blocker',
  'Remote private RPP-0290 ready atomic decision',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base-private-rpp0290";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0290 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsEntryRowId]: {
          entry_id: 290,
          status: 'submitted',
          payload: {
            mode: 'base-private-rpp0290-entry',
            ordinal: 1,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: 'base-private-rpp0290-option',
            limit: 10,
          },
          autoload: 'no',
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0290 decision post',
          post_status: 'publish',
        },
        'ID:2': {
          ID: 2,
          post_title: 'Base private RPP-0290 working post',
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
      precondition.checkedAgainst,
      precondition.expectedHash,
      `sha256:${digest(precondition)}`,
    ]),
    mutations: plan.mutations.map((mutation) => [
      mutation.id,
      mutation.resourceKey,
      mutation.action,
      mutation.changeKind,
      mutation.atomicGroupId || null,
      mutation.baseHash,
      mutation.localHash,
      mutation.remoteBeforeHash,
      `sha256:${digest([
        mutation.id,
        mutation.resourceKey,
        mutation.action,
        mutation.changeKind,
        mutation.atomicGroupId || null,
        mutation.baseHash,
        mutation.localHash,
        mutation.remoteBeforeHash,
      ])}`,
    ]),
    decisions: plan.decisions.map((decision) => [
      decision.id,
      decision.resourceKey,
      decision.decision,
      decision.change,
      `sha256:${digest(decision)}`,
    ]),
    conflicts: plan.conflicts.map((conflict) => [
      conflict.id,
      conflict.resourceKey,
      conflict.class,
      conflict.resolutionPolicy,
      conflict.baseHash,
      conflict.localHash,
      conflict.remoteHash,
      `sha256:${digest(conflict)}`,
    ]),
    blockers: plan.blockers.map((blocker) => [
      blocker.id,
      blocker.resourceKey || null,
      blocker.class,
      blocker.groupId || null,
      blocker.mutationId || null,
      [...(blocker.sourceBlockerIds || [])].sort(),
      `sha256:${digest(blocker)}`,
    ]),
    atomicGroups: plan.atomicGroups.map((group) => [
      group.id,
      group.status,
      [...group.mutationIds],
      [...group.conflicts],
      group.blockers.map((blocker) => [
        blocker.id,
        blocker.class,
        blocker.resourceKey || null,
        `sha256:${digest(blocker)}`,
      ]),
      `sha256:${digest({
        id: group.id,
        status: group.status,
        mutationIds: group.mutationIds,
        conflicts: group.conflicts,
        blockers: group.blockers.map((blocker) => blocker.id),
      })}`,
    ]),
  };
}

function readyMixedDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0290-ready-file";';
  local.db.wp_options[formsOptionRowId].option_value.mode = 'local-private-rpp0290-option-mode';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms'),
    ),
  };
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0290 keep-remote decision';

  return {
    label: 'RPP-0290 ready mixed mutation and decision fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0290-conflict-safe-file";';
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0290 conflicting post title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0290 decision beside conflict';
  remote.db.wp_posts['ID:2'].post_title = 'Remote private RPP-0290 conflicting post title';

  return {
    label: 'RPP-0290 conflict with safe mutation and decision fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0290-blocked-safe-file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0290-entry-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 2;
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0290 decision beside blocker';

  return {
    label: 'RPP-0290 blocked with safe mutation and decision fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0290-ready-atomic-index";';
  local.files[atomicReadyFilePath] = 'local-private-rpp0290-ready-atomic-create';
  local.pushIntents = [
    {
      id: readyAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, atomicReadyFileResourceKey],
    },
  ];
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0290 ready atomic decision';

  return {
    label: 'RPP-0290 ready atomic group fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0290-blocked-atomic-index";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0290-entry-atomic-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 3;
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0290 blocked atomic post';
  local.pushIntents = [
    {
      id: blockedAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, conflictPostResourceKey, formsEntryResourceKey],
    },
  ];

  return {
    label: 'RPP-0290 blocked atomic propagation fixture',
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
    const firstEnvelope = plannerSummaryEvidenceEnvelope(firstPlan);
    const replayEnvelope = plannerSummaryEvidenceEnvelope(replayPlan);

    assertPlannerSummaryMatchesEvidence(firstPlan, fixture.label);
    assertPlannerSummaryMatchesEvidence(replayPlan, `${fixture.label} replay`);
    assertPlanSurface(firstPlan, fixture);
    assert.deepEqual(
      firstEnvelope,
      replayEnvelope,
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
      envelopeHash: `sha256:${digest(firstEnvelope)}`,
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

function assertHashOnlyEvidence(value) {
  const serialized = JSON.stringify(value);

  for (const rawValue of rawFixtureValues) {
    assert.equal(serialized.includes(rawValue), false, `hash-only evidence leaked ${rawValue}`);
  }
  for (const rawFieldName of ['option_value', 'payload', 'post_title', '__pluginOwner']) {
    assert.equal(serialized.includes(rawFieldName), false, `hash-only evidence leaked raw field ${rawFieldName}`);
  }
}

test('RPP-0290 release verifier v5 planner summary counts match hash-only emitted evidence deterministically', () => {
  const firstEvidence = focusedPlannerSummaryEvidence();
  const replayEvidence = focusedPlannerSummaryEvidence();
  const aggregate = aggregateFocusedPlannerEvidence(firstEvidence);
  const evidenceEnvelope = {
    rpp: 'RPP-0290',
    evidenceSource: 'planner-summary-count-consistency-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    aggregate,
    aggregateHash: `sha256:${digest(aggregate)}`,
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
  assert.match(evidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assert.match(evidenceEnvelope.evidenceHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstEvidence);
  assertHashOnlyEvidence(evidenceEnvelope);
});
