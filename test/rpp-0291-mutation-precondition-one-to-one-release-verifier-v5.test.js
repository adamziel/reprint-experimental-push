import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js';
const caveat = 'Local deterministic Node focused release-verifier support proof; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsEntryRowId = 'entry_id:291';
const formsEntryResourceKey = 'row:["wp_forms_entries","entry_id:291"]';
const indexResourceKey = 'file:index.php';
const themeStyleResourceKey = 'file:wp-content/themes/reprint/style.css';
const createdUploadPath = 'wp-content/uploads/rpp-0291-ready-create.txt';
const createdUploadResourceKey = `file:${createdUploadPath}`;
const atomicReadyFilePath = 'wp-content/uploads/rpp-0291-ready-atomic.txt';
const atomicReadyFileResourceKey = `file:${atomicReadyFilePath}`;
const decisionPostResourceKey = 'row:["wp_posts","ID:1"]';
const workingPostResourceKey = 'row:["wp_posts","ID:2"]';
const readyAtomicGroupId = 'rpp-0291-ready-atomic-group-release-verifier-v5';
const blockedAtomicGroupId = 'rpp-0291-blocked-atomic-group-release-verifier-v5';

const rawFixtureValues = Object.freeze([
  '<?php echo "base-private-rpp0291";',
  '/* base-private-rpp0291-theme */',
  '<?php echo "local-private-rpp0291-ready-index";',
  'local-private-rpp0291-ready-create',
  'Local private RPP-0291 ready post',
  'local-private-rpp0291-option-mode',
  '<?php echo "local-private-rpp0291-conflict-safe-file";',
  'Local private RPP-0291 conflicting post title',
  'Remote private RPP-0291 conflicting post title',
  '<?php echo "local-private-rpp0291-blocked-safe-file";',
  'local-private-rpp0291-entry-blocked',
  '<?php echo "local-private-rpp0291-ready-atomic-index";',
  'local-private-rpp0291-ready-atomic-create',
  '<?php echo "local-private-rpp0291-blocked-atomic-index";',
  'local-private-rpp0291-entry-atomic-blocked',
  'Local private RPP-0291 blocked atomic post',
  'Remote private RPP-0291 keep-remote decision',
  'Remote private RPP-0291 decision beside conflict',
  'Remote private RPP-0291 decision beside blocker',
  'Remote private RPP-0291 ready atomic decision',
]);

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

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base-private-rpp0291";',
      'wp-content/themes/reprint/style.css': '/* base-private-rpp0291-theme */',
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0291 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_forms_entries: {
        [formsEntryRowId]: {
          entry_id: 291,
          status: 'submitted',
          payload: {
            mode: 'base-private-rpp0291-entry',
            ordinal: 1,
          },
          __pluginOwner: 'forms',
        },
      },
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: 'base-private-rpp0291-option',
            limit: 10,
          },
          autoload: 'no',
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base private RPP-0291 decision post',
          post_status: 'publish',
        },
        'ID:2': {
          ID: 2,
          post_title: 'Base private RPP-0291 working post',
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

function readyMixedFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0291-ready-index";';
  delete local.files['wp-content/themes/reprint/style.css'];
  local.files[createdUploadPath] = 'local-private-rpp0291-ready-create';
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0291 ready post';
  local.db.wp_options[formsOptionRowId].option_value.mode = 'local-private-rpp0291-option-mode';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms'),
    ),
  };
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0291 keep-remote decision';

  return {
    label: 'RPP-0291 ready mixed mutation and decision fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedSummary: {
      mutations: 5,
      decisions: 1,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    expectedMutationResourceKeys: [
      indexResourceKey,
      themeStyleResourceKey,
      createdUploadResourceKey,
      formsOptionResourceKey,
      workingPostResourceKey,
    ],
    expectedDecisionResourceKeys: [decisionPostResourceKey],
    expectedConflictResourceKeys: [],
    expectedBlockers: [],
    expectedAtomicGroups: [],
    staleReplayResourceKey: workingPostResourceKey,
  };
}

function conflictWithSafeMutationAndDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0291-conflict-safe-file";';
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0291 conflicting post title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0291 decision beside conflict';
  remote.db.wp_posts['ID:2'].post_title = 'Remote private RPP-0291 conflicting post title';

  return {
    label: 'RPP-0291 conflict with safe mutation and decision fixture',
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
    expectedConflictResourceKeys: [workingPostResourceKey],
    expectedBlockers: [],
    expectedAtomicGroups: [],
  };
}

function blockedWithSafeMutationAndDecisionFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0291-blocked-safe-file";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0291-entry-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 2;
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0291 decision beside blocker';

  return {
    label: 'RPP-0291 blocked with safe mutation and decision fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0291-ready-atomic-index";';
  local.files[atomicReadyFilePath] = 'local-private-rpp0291-ready-atomic-create';
  local.pushIntents = [
    {
      id: readyAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, atomicReadyFileResourceKey],
    },
  ];
  remote.db.wp_posts['ID:1'].post_title = 'Remote private RPP-0291 ready atomic decision';

  return {
    label: 'RPP-0291 ready atomic group fixture',
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

  local.files['index.php'] = '<?php echo "local-private-rpp0291-blocked-atomic-index";';
  local.db.wp_forms_entries[formsEntryRowId].payload.mode = 'local-private-rpp0291-entry-atomic-blocked';
  local.db.wp_forms_entries[formsEntryRowId].payload.ordinal = 3;
  local.db.wp_posts['ID:2'].post_title = 'Local private RPP-0291 blocked atomic post';
  local.pushIntents = [
    {
      id: blockedAtomicGroupId,
      kind: 'change-set',
      requireAtomic: true,
      resources: [indexResourceKey, workingPostResourceKey, formsEntryResourceKey],
    },
  ];

  return {
    label: 'RPP-0291 blocked atomic propagation fixture',
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
    expectedMutationResourceKeys: [indexResourceKey, workingPostResourceKey],
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
    readyMixedFixture(),
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

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
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

function assertPlanSurface(plan, fixture) {
  assert.equal(plan.status, fixture.expectedStatus, `${fixture.label} status`);
  assert.deepEqual(plan.summary, fixture.expectedSummary, `${fixture.label} summary`);
  assert.deepEqual(
    plan.summary,
    emittedPlannerCounts(plan),
    `${fixture.label} summary must match emitted planner evidence counts`,
  );
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

function assertMutationPreconditionOneToOne({ label, remote, plan }) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  const mutationById = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(mutationById.has(mutation.id), false, `${label} duplicate mutation id ${mutation.id}`);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${label} mutation resource key mismatch`);
    mutationById.set(mutation.id, mutation);
  }

  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
    const mutation = mutationById.get(precondition.mutationId);
    assert.ok(mutation, `${label} orphan precondition ${precondition.mutationId}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource object mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      precondition.expectedHash,
      resourceHash(remote, mutation.resource),
      `${label} precondition should bind to the live remote hash`,
    );
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope mismatch`);
  }

  for (const mutation of plan.mutations) {
    assert.ok(
      preconditionByMutationId.has(mutation.id),
      `${label} missing precondition for ${mutation.id}`,
    );
  }

  return preconditionByMutationId;
}

function mappingEvidenceForPlan(plan) {
  const preconditionsByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );

  return {
    status: plan.status,
    summary: plan.summary,
    mutationResourceKeySetHash: `sha256:${digest(plan.mutations.map((mutation) => mutation.resourceKey).sort())}`,
    preconditionResourceKeySetHash: `sha256:${digest(plan.preconditions.map((precondition) => precondition.resourceKey).sort())}`,
    mutationIdSetHash: `sha256:${digest(plan.mutations.map((mutation) => mutation.id).sort())}`,
    preconditionMutationIdSetHash: `sha256:${digest(plan.preconditions.map((precondition) => precondition.mutationId).sort())}`,
    bindings: plan.mutations
      .map((mutation) => {
        const precondition = preconditionsByMutationId.get(mutation.id);

        return {
          mutationIdHash: `sha256:${digest(mutation.id)}`,
          resourceKey: mutation.resourceKey,
          action: mutation.action,
          changeKind: mutation.changeKind,
          atomicGroupId: mutation.atomicGroupId || null,
          checkedAgainst: precondition.checkedAgainst,
          remoteBeforeHash: mutation.remoteBeforeHash,
          expectedHash: precondition.expectedHash,
          bindingHash: `sha256:${digest({
            mutationId: mutation.id,
            preconditionMutationId: precondition.mutationId,
            resourceKey: mutation.resourceKey,
            preconditionResourceKey: precondition.resourceKey,
            remoteBeforeHash: mutation.remoteBeforeHash,
            expectedHash: precondition.expectedHash,
            checkedAgainst: precondition.checkedAgainst,
          })}`,
        };
      })
      .sort((left, right) => left.mutationIdHash.localeCompare(right.mutationIdHash)),
  };
}

function assertReadyApplyAndStaleReplay(fixture, plan) {
  if (!fixture.staleReplayResourceKey) {
    return;
  }

  const applied = applyPlan(cloneJson(fixture.remote), plan);
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(applied.site, mutation.resource),
      mutation.localHash,
      `${fixture.label} did not apply planned local hash for ${mutation.resourceKey}`,
    );
  }

  const staleMutation = plan.mutations.find(
    (mutation) => mutation.resourceKey === fixture.staleReplayResourceKey,
  );
  assert.ok(staleMutation, `${fixture.label} missing stale replay target mutation`);
  const stalePrecondition = plan.preconditions.find(
    (precondition) => precondition.mutationId === staleMutation.id,
  );
  assert.ok(stalePrecondition, `${fixture.label} missing stale replay target precondition`);

  const driftedRemote = cloneJson(fixture.remote);
  driftedRemote.db.wp_posts['ID:2'].post_title = 'Remote private RPP-0291 stale replay drift';
  const remoteBeforeHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan));

  assert.ok(error instanceof PushPlanError, `${fixture.label} stale replay should fail with PushPlanError`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(digest(driftedRemote), remoteBeforeHash, `${fixture.label} stale replay mutated the remote`);
  assert.equal(error.details.resourceKey, staleMutation.resourceKey);
  assert.equal(error.details.expectedHash, stalePrecondition.expectedHash);
}

function assertReadyPlanInvariantRefusals(fixture, plan) {
  const [firstMutation, secondMutation] = plan.mutations;
  const firstPrecondition = plan.preconditions.find(
    (precondition) => precondition.mutationId === firstMutation.id,
  );
  const secondPrecondition = plan.preconditions.find(
    (precondition) => precondition.mutationId === secondMutation.id,
  );
  assert.ok(firstPrecondition, `${fixture.label} missing first precondition`);
  assert.ok(secondPrecondition, `${fixture.label} missing second precondition`);

  const forgedPlans = [
    {
      label: 'missing precondition',
      mutate: (forgedPlan) => {
        forgedPlan.preconditions = forgedPlan.preconditions.filter(
          (precondition) => precondition.mutationId !== firstMutation.id,
        );
      },
    },
    {
      label: 'duplicate precondition',
      mutate: (forgedPlan) => {
        forgedPlan.preconditions.push(cloneJson(firstPrecondition));
      },
    },
    {
      label: 'orphan precondition',
      mutate: (forgedPlan) => {
        forgedPlan.preconditions.push({
          ...cloneJson(firstPrecondition),
          mutationId: 'rpp-0291-orphan-mutation',
        });
      },
    },
    {
      label: 'resource key mismatch',
      mutate: (forgedPlan) => {
        const target = forgedPlan.preconditions.find(
          (precondition) => precondition.mutationId === firstMutation.id,
        );
        target.resourceKey = secondMutation.resourceKey;
      },
    },
    {
      label: 'resource object mismatch',
      mutate: (forgedPlan) => {
        const target = forgedPlan.preconditions.find(
          (precondition) => precondition.mutationId === firstMutation.id,
        );
        target.resource = cloneJson(secondPrecondition.resource);
      },
    },
    {
      label: 'hash mismatch',
      mutate: (forgedPlan) => {
        const target = forgedPlan.preconditions.find(
          (precondition) => precondition.mutationId === firstMutation.id,
        );
        target.expectedHash = secondPrecondition.expectedHash;
      },
    },
    {
      label: 'non-live-remote scope',
      mutate: (forgedPlan) => {
        const target = forgedPlan.preconditions.find(
          (precondition) => precondition.mutationId === firstMutation.id,
        );
        target.checkedAgainst = 'base';
      },
    },
  ];

  for (const forgedCase of forgedPlans) {
    const forgedPlan = cloneJson(plan);
    forgedCase.mutate(forgedPlan);
    const remoteBeforeHash = digest(fixture.remote);
    const error = captureError(() => applyPlan(cloneJson(fixture.remote), forgedPlan));

    assert.ok(
      error instanceof PushPlanError,
      `${fixture.label} ${forgedCase.label} should fail with PushPlanError`,
    );
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', `${fixture.label} ${forgedCase.label} code`);
    assert.equal(
      digest(fixture.remote),
      remoteBeforeHash,
      `${fixture.label} ${forgedCase.label} should not mutate fixture remote`,
    );
  }
}

function focusedMappingEvidence() {
  return focusedFixtures().map((fixture) => {
    const firstPlan = planFor(fixture);
    const replayPlan = planFor({
      base: cloneJson(fixture.base),
      local: cloneJson(fixture.local),
      remote: cloneJson(fixture.remote),
    });
    const firstEvidence = mappingEvidenceForPlan(firstPlan);
    const replayEvidence = mappingEvidenceForPlan(replayPlan);
    const preconditionsByMutationId = assertMutationPreconditionOneToOne({
      label: fixture.label,
      remote: fixture.remote,
      plan: firstPlan,
    });

    assertMutationPreconditionOneToOne({
      label: `${fixture.label} replay`,
      remote: fixture.remote,
      plan: replayPlan,
    });
    assertPlanSurface(firstPlan, fixture);
    assert.deepEqual(
      firstEvidence,
      replayEvidence,
      `${fixture.label} mutation/precondition evidence changed between deterministic planning runs`,
    );
    assertReadyApplyAndStaleReplay(fixture, firstPlan);
    if (fixture.staleReplayResourceKey) {
      assertReadyPlanInvariantRefusals(fixture, firstPlan);
    }

    return {
      label: fixture.label,
      status: firstPlan.status,
      summary: firstPlan.summary,
      preconditions: firstPlan.preconditions.length,
      mutationResourceKeys: sortStrings(firstPlan.mutations.map((mutation) => mutation.resourceKey)),
      preconditionResourceKeys: sortStrings(firstPlan.preconditions.map((precondition) => precondition.resourceKey)),
      decisionResourceKeys: sortStrings(firstPlan.decisions.map((decision) => decision.resourceKey)),
      conflictResourceKeys: sortStrings(firstPlan.conflicts.map((conflict) => conflict.resourceKey)),
      blockerClasses: sortStrings(firstPlan.blockers.map((blocker) => blocker.class)),
      atomicGroupStatuses: firstPlan.atomicGroups.map((group) => [group.id, group.status]),
      bindingHashes: firstPlan.mutations.map((mutation) => {
        const precondition = preconditionsByMutationId.get(mutation.id);

        return `sha256:${digest({
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          preconditionMutationId: precondition.mutationId,
          preconditionResourceKey: precondition.resourceKey,
          remoteBeforeHash: mutation.remoteBeforeHash,
          expectedHash: precondition.expectedHash,
          checkedAgainst: precondition.checkedAgainst,
        })}`;
      }).sort(),
      envelopeHash: `sha256:${digest(firstEvidence)}`,
    };
  });
}

function generatedMappingEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    totals: {
      mutations: 0,
      preconditions: 0,
    },
    maxMutations: 0,
    readyCasesWithMutations: 0,
    nonReadyCasesWithMutations: 0,
    familiesWithMutations: {},
    caseProofs: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });
    const label = `RPP-0291 generated ${testCase.id}`;
    const planEvidence = mappingEvidenceForPlan(plan);

    assertMutationPreconditionOneToOne({ label, remote: testCase.remote, plan });
    incrementCount(evidence.statuses, plan.status);
    evidence.totals.mutations += plan.mutations.length;
    evidence.totals.preconditions += plan.preconditions.length;
    evidence.maxMutations = Math.max(evidence.maxMutations, plan.mutations.length);
    if (plan.mutations.length > 0) {
      incrementCount(evidence.familiesWithMutations, testCase.family);
      if (plan.status === 'ready') {
        evidence.readyCasesWithMutations += 1;
      } else {
        evidence.nonReadyCasesWithMutations += 1;
      }
    }
    evidence.caseProofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      mutationResourceKeySetHash: planEvidence.mutationResourceKeySetHash,
      preconditionResourceKeySetHash: planEvidence.preconditionResourceKeySetHash,
      mutationIdSetHash: planEvidence.mutationIdSetHash,
      preconditionMutationIdSetHash: planEvidence.preconditionMutationIdSetHash,
      bindingHash: `sha256:${digest(planEvidence.bindings)}`,
    });
  }

  return {
    ...evidence,
    statuses: sortedObject(evidence.statuses),
    familiesWithMutations: sortedObject(evidence.familiesWithMutations),
  };
}

function aggregateFocusedEvidence(evidence) {
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

function assertGeneratedEvidence(evidence) {
  assert.equal(evidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(evidence.totals.preconditions, evidence.totals.mutations);
  assert.ok(evidence.statuses.ready > 0, 'RPP-0291 generated proof needs ready cases');
  assert.ok(evidence.statuses.conflict > 0, 'RPP-0291 generated proof needs conflict cases');
  assert.ok(evidence.statuses.blocked > 0, 'RPP-0291 generated proof needs blocked cases');
  assert.ok(
    evidence.readyCasesWithMutations > 0,
    'RPP-0291 generated proof needs ready cases with planned mutations',
  );
  assert.ok(
    evidence.nonReadyCasesWithMutations > 0,
    'RPP-0291 generated proof needs non-ready cases that still emit safe planned mutations',
  );
  assert.ok(evidence.maxMutations >= 15, 'RPP-0291 generated proof needs high-mutation fixtures');

  for (const proof of evidence.caseProofs) {
    assert.equal(
      proof.preconditionCount,
      proof.mutationCount,
      `${proof.id} precondition count should match mutation count`,
    );
    assert.equal(
      proof.preconditionResourceKeySetHash,
      proof.mutationResourceKeySetHash,
      `${proof.id} precondition resource surface should match mutation surface`,
    );
    assert.equal(
      proof.preconditionMutationIdSetHash,
      proof.mutationIdSetHash,
      `${proof.id} precondition mutation ids should match mutation ids`,
    );
    assert.match(proof.bindingHash, sha256EvidencePattern);
  }
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

test('RPP-0291 release verifier v5 maps every mutation to one live-remote precondition', () => {
  const firstFocusedEvidence = focusedMappingEvidence();
  const replayFocusedEvidence = focusedMappingEvidence();
  const firstGeneratedEvidence = generatedMappingEvidence();
  const replayGeneratedEvidence = generatedMappingEvidence();
  const focusedAggregate = aggregateFocusedEvidence(firstFocusedEvidence);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0291',
    evidenceSource: 'mutation-precondition-one-to-one-release-verifier-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    focused: focusedAggregate,
    generated: {
      totalCases: firstGeneratedEvidence.totalCases,
      statuses: firstGeneratedEvidence.statuses,
      totals: firstGeneratedEvidence.totals,
      maxMutations: firstGeneratedEvidence.maxMutations,
      readyCasesWithMutations: firstGeneratedEvidence.readyCasesWithMutations,
      nonReadyCasesWithMutations: firstGeneratedEvidence.nonReadyCasesWithMutations,
      familyCountWithMutations: Object.keys(firstGeneratedEvidence.familiesWithMutations).length,
    },
    focusedHash: `sha256:${digest(firstFocusedEvidence)}`,
    generatedHash: `sha256:${digest(firstGeneratedEvidence)}`,
    aggregateHash: `sha256:${digest({ focusedAggregate, generated: firstGeneratedEvidence })}`,
  };

  assert.deepEqual(
    firstFocusedEvidence,
    replayFocusedEvidence,
    'RPP-0291 focused release-verifier evidence changed between runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0291 generated release-verifier evidence changed between runs',
  );
  assert.deepEqual(focusedAggregate, {
    totalCases: 5,
    statuses: {
      blocked: 2,
      conflict: 1,
      ready: 2,
    },
    totalMutations: 11,
    totalDecisions: 4,
    totalConflicts: 1,
    totalBlockers: 4,
    totalAtomicGroups: 2,
    totalPreconditions: 11,
  });
  assert.equal(focusedAggregate.totalPreconditions, focusedAggregate.totalMutations);
  assertGeneratedEvidence(firstGeneratedEvidence);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence);
  assertHashOnlyEvidence(releaseEvidenceEnvelope);
});
