import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const command = 'node --test test/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.test.js';
const caveat = 'Local deterministic release-verifier support proof only; final release remains NO-GO.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const expectedGeneratedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

const targetCoverageKey = 'atomicPluginInstallStackReleaseVerifierVariant5';
const targetTag = 'atomic-plugin-install-stack-release-verifier-v5';
const readyTag = 'atomic-plugin-stack-ready-release-verifier-v5';
const missingDependencyTag = 'atomic-plugin-stack-missing-dependency-release-verifier-v5';
const generatedGroupId = 'install-generated-dependent-without-dependency';

const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';
const atomicDependentPluginFile = pluginMainFile(atomicDependentPlugin);
const generatedDependentFileResourceKey = fileResourceKey(atomicDependentPluginFile);
const generatedDependentPluginResourceKey = pluginResourceKey(atomicDependentPlugin);
const generatedDependencyPluginResourceKey = pluginResourceKey(atomicDependencyPlugin);

const focusedGroupId = 'rpp-0300-atomic-blocked-release-verifier-v5';
const focusedIndexResourceKey = 'file:index.php';
const focusedPostResourceKey = rowResourceKey('wp_posts', 'ID:300');
const focusedUnsupportedRowResourceKey = rowResourceKey('wp_options', 'option_name:forms_settings');
const focusedDependentFileResourceKey = fileResourceKey(atomicDependentPluginFile);
const focusedDependentPluginResourceKey = pluginResourceKey(atomicDependentPlugin);
const focusedPrivateValues = Object.freeze([
  '<?php echo "base-private-rpp0300-index";',
  '<?php echo "local-private-rpp0300-index";',
  '<?php /* local-private-rpp0300-dependent-plugin */',
  'Base private RPP-0300 post',
  'Local private RPP-0300 post',
  'base-private-rpp0300-option-mode',
  'local-private-rpp0300-option-mode',
  'rpp0300-private-dependency-access-token',
]);

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function fileResourceKey(path) {
  return `file:${path}`;
}

function pluginResourceKey(name) {
  return `plugin:${name}`;
}

function rowResourceKey(table, id) {
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

function sortStrings(values) {
  return [...values].sort();
}

function sortObject(object, compare = ([left], [right]) => left.localeCompare(right)) {
  return Object.fromEntries(Object.entries(object).sort(compare));
}

function sortNumericObject(object) {
  return sortObject(object, ([left], [right]) => Number(left) - Number(right));
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
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

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '3'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function focusedBaseSite() {
  return {
    files: {
      'index.php': focusedPrivateValues[0],
      'wp-content/plugins/forms/forms.php': '<?php /* forms rpp0300 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: {
            mode: focusedPrivateValues[5],
          },
          __pluginOwner: 'forms',
        },
        'option_name:blogname': {
          option_name: 'blogname',
          option_value: 'RPP 0300 Base',
        },
      },
      wp_posts: {
        'ID:300': {
          ID: 300,
          post_title: focusedPrivateValues[3],
          post_status: 'publish',
        },
      },
    },
  };
}

function focusedFixture() {
  const base = focusedBaseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = focusedPrivateValues[1];
  local.files[atomicDependentPluginFile] = focusedPrivateValues[2];
  local.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  local.db.wp_posts['ID:300'].post_title = focusedPrivateValues[4];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = focusedPrivateValues[6];
  local.pushIntents = [
    {
      id: focusedGroupId,
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        focusedIndexResourceKey,
        focusedPostResourceKey,
        focusedDependentFileResourceKey,
        focusedDependentPluginResourceKey,
        focusedUnsupportedRowResourceKey,
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            expectedVersion: '2.1.0',
            active: true,
            accessToken: focusedPrivateValues[7],
          },
        ],
      },
    },
  ];

  return {
    label: 'RPP-0300 focused mixed resource and group-level atomic blockers',
    base,
    local,
    remote,
    expectedGroupedMutationResourceKeys: [
      focusedIndexResourceKey,
      focusedPostResourceKey,
      focusedDependentFileResourceKey,
      focusedDependentPluginResourceKey,
    ],
    expectedDirectBlockerClasses: [
      'missing-plugin-dependency',
      'unsupported-plugin-owned-resource',
    ],
  };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertSha256Hex(value, label) {
  assert.match(value, sha256HexPattern, label);
}

function assertPlanSummary(plan, label) {
  assert.deepEqual(plan.summary, emittedPlannerCounts(plan), `${label} emitted summary counts`);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  const preconditionsByMutationId = new Map();

  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per planned mutation`,
  );

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
    assert.ok(precondition, `${label} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition expected hash`);
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} mutation ${mutation.resourceKey} remote hash must bind to live remote`,
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
  const afterRemoteHash = digest(applyRemote);

  assert.ok(error instanceof PushPlanError, `${label} should throw PushPlanError`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${label} refusal code`);
  assert.deepEqual(error.details, { status: plan.status }, `${label} refusal details`);
  assert.equal(returnedResult, null, `${label} returned an apply result`);
  assert.equal(beforeMutationCalls, 0, `${label} reached mutation callback`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal events`);
  assert.equal(JSON.stringify(applyRemote), beforeRemoteJson, `${label} mutated remote JSON`);
  assert.equal(afterRemoteHash, beforeRemoteHash, `${label} changed remote hash`);

  return {
    code: error.code,
    status: error.details.status,
    detailsHash: sha256Evidence(error.details),
    beforeRemoteHash: sha256Evidence(beforeRemoteHash),
    afterRemoteHash: sha256Evidence(afterRemoteHash),
    remotePreserved: afterRemoteHash === beforeRemoteHash,
    beforeMutationCalls,
    durableJournalEventCount: journalEvents.length,
    appliedMutationCount: 0,
    preMutationRefusal: true,
  };
}

function groupMutationsFor(plan, group, label) {
  const mutationsById = new Map(plan.mutations.map((mutation) => [mutation.id, mutation]));
  const mutations = group.mutationIds.map((mutationId) => mutationsById.get(mutationId));

  assert.equal(mutations.every(Boolean), true, `${label} group references only emitted mutations`);
  return mutations.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
}

function splitGroupBlockers(group) {
  return {
    directBlockers: group.blockers
      .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation')
      .sort((left, right) => `${left.class}:${left.id}`.localeCompare(`${right.class}:${right.id}`)),
    propagatedBlockers: group.blockers
      .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
      .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
  };
}

function assertPropagationCoversGroupedMutations({ group, groupMutations, directBlockers, propagatedBlockers, label }) {
  const mutationsById = new Map(groupMutations.map((mutation) => [mutation.id, mutation]));
  const propagatedByMutationId = new Map(propagatedBlockers.map((blocker) => [blocker.mutationId, blocker]));
  const sourceBlockerIds = directBlockers.map((blocker) => blocker.id).sort();

  assert.equal(
    propagatedBlockers.length,
    groupMutations.length,
    `${label} should propagate one blocker to every grouped mutation`,
  );

  for (const mutation of groupMutations) {
    const propagated = propagatedByMutationId.get(mutation.id);
    assert.ok(propagated, `${label} missing propagated blocker for ${mutation.resourceKey}`);
    assert.equal(mutationsById.has(propagated.mutationId), true, `${label} propagated blocker mutation id`);
    assert.equal(propagated.groupId, group.id, `${label} propagated group id`);
    assert.equal(propagated.resourceKey, mutation.resourceKey, `${label} propagated resource key`);
    assert.deepEqual(
      [...propagated.sourceBlockerIds].sort(),
      sourceBlockerIds,
      `${label} propagated source blocker ids`,
    );
  }
}

function mutationEvidence(mutation) {
  return {
    idHash: sha256Evidence(mutation.id),
    resourceKey: mutation.resourceKey,
    resourceType: mutation.resource.type,
    action: mutation.action,
    changeKind: mutation.changeKind,
    atomicGroupIdHash: mutation.atomicGroupId ? sha256Evidence(mutation.atomicGroupId) : null,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    plannedResourceHash: sha256Evidence(deserializeResourceValue(mutation.value)),
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

function directBlockerEvidence(blocker) {
  return {
    idHash: sha256Evidence(blocker.id),
    class: blocker.class,
    resourceKey: blocker.resourceKey || null,
    groupIdHash: blocker.groupId ? sha256Evidence(blocker.groupId) : null,
    plugin: blocker.plugin || null,
    pluginOwner: blocker.pluginOwner || null,
    reasonCode: blocker.reasonCode || null,
    baseHash: blocker.baseHash || null,
    localHash: blocker.localHash || null,
    remoteHash: blocker.remoteHash || null,
    blockerHash: sha256Evidence(blocker),
  };
}

function propagatedBlockerEvidence(blocker) {
  return {
    idHash: sha256Evidence(blocker.id),
    class: blocker.class,
    resourceKey: blocker.resourceKey,
    mutationIdHash: sha256Evidence(blocker.mutationId),
    groupIdHash: sha256Evidence(blocker.groupId),
    sourceBlockerIdHashes: blocker.sourceBlockerIds.map(sha256Evidence).sort(),
    blockerHash: sha256Evidence(blocker),
  };
}

function dependencyRequirementEvidence(requirement) {
  return {
    plugin: requirement.plugin,
    source: requirement.source,
    resourceKey: requirement.resourceKey,
    expectedVersion: requirement.expectedVersion || null,
    expectedHash: requirement.expectedHash || null,
    plannedHash: requirement.plannedHash || null,
    remoteHash: requirement.remoteHash || null,
    requirementHash: sha256Evidence(requirement),
  };
}

function focusedAtomicBlockerEvidence() {
  const fixture = focusedFixture();
  const plan = planFor(fixture);
  const group = plan.atomicGroups.find((entry) => entry.id === focusedGroupId);

  assert.ok(group, `${fixture.label} missing atomic group`);
  assert.equal(plan.status, 'blocked', `${fixture.label} plan status`);
  assert.equal(group.status, 'blocked', `${fixture.label} group status`);
  assert.equal(group.requireAtomic, true, `${fixture.label} requireAtomic`);
  assert.equal(plan.conflicts.length, 0, `${fixture.label} conflict evidence`);
  assertPlanSummary(plan, fixture.label);
  assertEveryMutationHasLiveRemotePrecondition(plan, fixture.remote, fixture.label);
  assert.equal(mutationFor(plan, focusedUnsupportedRowResourceKey), undefined, `${fixture.label} unsupported row mutation`);
  assert.equal(
    preconditionFor(plan, focusedUnsupportedRowResourceKey),
    undefined,
    `${fixture.label} unsupported row precondition`,
  );

  const groupMutations = groupMutationsFor(plan, group, fixture.label);
  const { directBlockers, propagatedBlockers } = splitGroupBlockers(group);

  assert.deepEqual(
    groupMutations.map((mutation) => mutation.resourceKey),
    sortStrings(fixture.expectedGroupedMutationResourceKeys),
    `${fixture.label} grouped mutation resources`,
  );
  assert.deepEqual(
    directBlockers.map((blocker) => blocker.class).sort(),
    fixture.expectedDirectBlockerClasses,
    `${fixture.label} direct blocker classes`,
  );
  assert.equal(
    directBlockers.find((blocker) => blocker.class === 'missing-plugin-dependency')?.dependency?.accessToken,
    undefined,
    `${fixture.label} dependency blocker should not expose private access fields`,
  );
  assertPropagationCoversGroupedMutations({
    group,
    groupMutations,
    directBlockers,
    propagatedBlockers,
    label: fixture.label,
  });

  const focusedEvidence = {
    label: fixture.label,
    status: plan.status,
    summary: plan.summary,
    group: {
      idHash: sha256Evidence(group.id),
      kind: group.kind,
      status: group.status,
      requireAtomic: group.requireAtomic,
      resourceKeys: sortStrings(group.resources),
      mutationIdHashes: group.mutationIds.map(sha256Evidence).sort(),
      groupHash: sha256Evidence(group),
      dependencyRequirements: group.dependencyRequirements.map(dependencyRequirementEvidence),
      directBlockers: directBlockers.map(directBlockerEvidence),
      propagatedBlockers: propagatedBlockers.map(propagatedBlockerEvidence),
    },
    groupedMutations: groupMutations.map(mutationEvidence),
    groupedPreconditions: groupMutations.map((mutation) => {
      const precondition = plan.preconditions.find((candidate) => candidate.mutationId === mutation.id);
      return preconditionEvidence(precondition);
    }),
    unsupportedResource: {
      resourceKey: focusedUnsupportedRowResourceKey,
      emittedMutation: false,
      emittedPrecondition: false,
    },
    refusal: assertBlockedApplyRefusesBeforeMutation({
      plan,
      remote: fixture.remote,
      label: fixture.label,
    }),
  };

  assertHashOnlyEvidence(focusedEvidence, 'RPP-0300 focused release-verifier evidence');

  return {
    ...focusedEvidence,
    caseProofHash: sha256Evidence(focusedEvidence),
  };
}

function releaseVerifierVariant5MissingDependencyCases() {
  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(missingDependencyTag));

  assert.equal(cases.length, 10, 'RPP-0300 needs one release-verifier v5 missing-dependency case per tier');
  assert.deepEqual(
    sortNumericObject(Object.fromEntries(cases.map((testCase) => [String(testCase.tier), 1]))),
    Object.fromEntries(expectedGeneratedTiers.map((tier) => [String(tier), 1])),
    'RPP-0300 release-verifier v5 missing-dependency cases should span tiers 0 through 9',
  );
  assert.equal(
    cases.every((testCase) => testCase.tags.has(targetTag)),
    true,
    'RPP-0300 selected cases must belong to the release-verifier v5 target',
  );

  return cases;
}

function generatedAtomicBlockerCaseEvidence(testCase) {
  const validation = validateGeneratedCase(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
  const group = plan.atomicGroups.find((entry) => entry.id === generatedGroupId);

  assert.ok(group, `${testCase.id} missing generated atomic group`);
  assert.equal(testCase.family, 'atomic-plugin-missing-dependency', `${testCase.id} family changed`);
  assert.equal(testCase.tags.has(targetTag), true, `${testCase.id} missing release-verifier v5 target tag`);
  assert.equal(testCase.tags.has(missingDependencyTag), true, `${testCase.id} missing release-verifier v5 blocker tag`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should be non-ready`);
  assert.equal(validation.status, plan.status, `${testCase.id} validation status`);
  assert.equal(validation.applied, false, `${testCase.id} validation applied`);
  assert.equal(validation.nonReadyRemoteUnchanged, true, `${testCase.id} validation remote preservation`);
  assert.equal(group.status, 'blocked', `${testCase.id} group status`);
  assert.equal(group.requireAtomic, true, `${testCase.id} requireAtomic`);
  assert.deepEqual(
    sortStrings(group.resources),
    sortStrings([generatedDependentFileResourceKey, generatedDependentPluginResourceKey]),
    `${testCase.id} group resources`,
  );
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === generatedDependencyPluginResourceKey),
    false,
    `${testCase.id} must not synthesize the missing dependency plugin mutation`,
  );
  assertPlanSummary(plan, testCase.id);
  assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

  const groupMutations = groupMutationsFor(plan, group, testCase.id);
  const { directBlockers, propagatedBlockers } = splitGroupBlockers(group);

  assert.deepEqual(
    groupMutations.map((mutation) => mutation.resourceKey),
    sortStrings([generatedDependentFileResourceKey, generatedDependentPluginResourceKey]),
    `${testCase.id} grouped mutation resources`,
  );
  assert.equal(directBlockers.length, 1, `${testCase.id} source blocker count`);
  assert.equal(directBlockers[0].class, 'missing-plugin-dependency', `${testCase.id} source blocker class`);
  assert.equal(directBlockers[0].plugin, atomicDependencyPlugin, `${testCase.id} source blocker plugin`);
  assert.equal(group.dependencyRequirements.length, 1, `${testCase.id} dependency requirement count`);
  assert.equal(group.dependencyRequirements[0].source, 'missing-live-remote', `${testCase.id} dependency source`);
  assert.equal(
    group.dependencyRequirements[0].resourceKey,
    generatedDependencyPluginResourceKey,
    `${testCase.id} dependency resource key`,
  );
  assertPropagationCoversGroupedMutations({
    group,
    groupMutations,
    directBlockers,
    propagatedBlockers,
    label: testCase.id,
  });

  const generatedEvidence = {
    idHash: sha256Evidence(testCase.id),
    tier: testCase.tier,
    family: testCase.family,
    variantTags: [targetTag, missingDependencyTag],
    status: plan.status,
    summary: plan.summary,
    validation: {
      status: validation.status,
      applied: validation.applied,
      nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged,
    },
    group: {
      idHash: sha256Evidence(group.id),
      kind: group.kind,
      status: group.status,
      requireAtomic: group.requireAtomic,
      resourceKeys: sortStrings(group.resources),
      mutationIdHashes: group.mutationIds.map(sha256Evidence).sort(),
      groupHash: sha256Evidence(group),
      dependencyRequirements: group.dependencyRequirements.map(dependencyRequirementEvidence),
      directBlockers: directBlockers.map(directBlockerEvidence),
      propagatedBlockers: propagatedBlockers.map(propagatedBlockerEvidence),
    },
    groupedMutations: groupMutations.map(mutationEvidence),
    groupedPreconditions: groupMutations.map((mutation) => {
      const precondition = plan.preconditions.find((candidate) => candidate.mutationId === mutation.id);
      return preconditionEvidence(precondition);
    }),
    refusal: assertBlockedApplyRefusesBeforeMutation({
      plan,
      remote: testCase.remote,
      label: testCase.id,
    }),
  };

  assertHashOnlyEvidence(generatedEvidence, `${testCase.id} release-verifier v5 evidence`);

  return {
    ...generatedEvidence,
    caseProofHash: sha256Evidence(generatedEvidence),
  };
}

function generatedAtomicBlockerEvidence() {
  return releaseVerifierVariant5MissingDependencyCases().map(generatedAtomicBlockerCaseEvidence);
}

function aggregateAtomicBlockerEvidence(evidence, targetCoverage) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    perTier: {},
    totalBlockedGroups: 0,
    totalGroupMutations: 0,
    totalGroupedPreconditions: 0,
    totalDirectBlockers: 0,
    totalPropagatedBlockers: 0,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    preMutationRefusals: 0,
    remotePreserved: 0,
    sourceBlockerClasses: {},
    refusalCodes: {},
    targetCoverage: targetCoverage
      ? {
          key: targetCoverageKey,
          tag: targetTag,
          total: targetCoverage.total,
          statuses: targetCoverage.statuses,
          perTier: targetCoverage.perTier,
        }
      : null,
  };

  for (const entry of evidence) {
    increment(aggregate.statuses, entry.status);
    if (entry.tier !== undefined) {
      increment(aggregate.perTier, entry.tier);
    }
    aggregate.totalBlockedGroups += entry.group.status === 'blocked' ? 1 : 0;
    aggregate.totalGroupMutations += entry.groupedMutations.length;
    aggregate.totalGroupedPreconditions += entry.groupedPreconditions.length;
    aggregate.totalDirectBlockers += entry.group.directBlockers.length;
    aggregate.totalPropagatedBlockers += entry.group.propagatedBlockers.length;
    aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
    aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
    aggregate.totalBeforeMutationCalls += entry.refusal.beforeMutationCalls;
    aggregate.preMutationRefusals += entry.refusal.preMutationRefusal ? 1 : 0;
    aggregate.remotePreserved += entry.refusal.remotePreserved ? 1 : 0;
    increment(aggregate.refusalCodes, entry.refusal.code);
    for (const blocker of entry.group.directBlockers) {
      increment(aggregate.sourceBlockerClasses, blocker.class);
    }
  }

  return {
    ...aggregate,
    statuses: sortObject(aggregate.statuses),
    perTier: sortNumericObject(aggregate.perTier),
    sourceBlockerClasses: sortObject(aggregate.sourceBlockerClasses),
    refusalCodes: sortObject(aggregate.refusalCodes),
  };
}

function assertFocusedAggregate(aggregate) {
  assert.deepEqual(aggregate, {
    totalCases: 1,
    statuses: { blocked: 1 },
    perTier: {},
    totalBlockedGroups: 1,
    totalGroupMutations: 4,
    totalGroupedPreconditions: 4,
    totalDirectBlockers: 2,
    totalPropagatedBlockers: 4,
    totalAppliedMutations: 0,
    totalDurableJournalEvents: 0,
    totalBeforeMutationCalls: 0,
    preMutationRefusals: 1,
    remotePreserved: 1,
    sourceBlockerClasses: {
      'missing-plugin-dependency': 1,
      'unsupported-plugin-owned-resource': 1,
    },
    refusalCodes: { PLAN_NOT_READY: 1 },
    targetCoverage: null,
  });
}

function assertGeneratedAggregate(aggregate) {
  assert.equal(aggregate.totalCases, 10);
  assert.deepEqual(aggregate.statuses, { blocked: 2, conflict: 8 });
  assert.deepEqual(
    aggregate.perTier,
    Object.fromEntries(expectedGeneratedTiers.map((tier) => [String(tier), 1])),
  );
  assert.equal(aggregate.totalBlockedGroups, 10);
  assert.equal(aggregate.totalGroupMutations, 20);
  assert.equal(aggregate.totalGroupedPreconditions, 20);
  assert.equal(aggregate.totalDirectBlockers, 10);
  assert.equal(aggregate.totalPropagatedBlockers, 20);
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalBeforeMutationCalls, 0);
  assert.equal(aggregate.preMutationRefusals, 10);
  assert.equal(aggregate.remotePreserved, 10);
  assert.deepEqual(aggregate.sourceBlockerClasses, { 'missing-plugin-dependency': 10 });
  assert.deepEqual(aggregate.refusalCodes, { PLAN_NOT_READY: 10 });
  assert.deepEqual(aggregate.targetCoverage, {
    key: targetCoverageKey,
    tag: targetTag,
    total: 20,
    statuses: {
      blocked: 2,
      conflict: 8,
      ready: 10,
    },
    perTier: Object.fromEntries(expectedGeneratedTiers.map((tier) => [String(tier), 2])),
  });
}

function assertReleaseVerifierTargetCoverage(targetCoverage, report) {
  assert.ok(targetCoverage, 'missing atomic plugin install stack release-verifier v5 target coverage');
  assert.equal(targetCoverage.family, 'atomic-plugin-install-stack-release-verifier-v5');
  assert.equal(targetCoverage.total, report.summary.featureFamilies[targetTag]);
  assert.equal(targetCoverage.total, 20);
  assert.deepEqual(targetCoverage.statuses, { blocked: 2, conflict: 8, ready: 10 });
  assert.deepEqual(
    targetCoverage.perTier,
    Object.fromEntries(expectedGeneratedTiers.map((tier) => [String(tier), 2])),
  );
  assert.equal(report.summary.featureFamilies[readyTag], 10);
  assert.equal(report.summary.featureFamilies[missingDependencyTag], 10);
}

function assertEvidenceHashes(value) {
  const serialized = JSON.stringify(value);
  const evidenceHashes = serialized.match(/sha256:[a-f0-9]{64}/g) || [];
  const bareHashes = serialized.match(/(?<!sha256:)[a-f0-9]{64}/g) || [];

  assert.ok(evidenceHashes.length > 0, 'release-verifier proof should include sha256 evidence hashes');
  for (const evidenceHash of evidenceHashes) {
    assert.match(evidenceHash, sha256EvidencePattern);
  }
  for (const bareHash of bareHashes) {
    assert.match(bareHash, sha256HexPattern);
  }
}

function assertHashOnlyEvidence(value, label) {
  const serialized = JSON.stringify(value);
  const forbiddenRawMarkers = [
    ...focusedPrivateValues,
    '<?php',
    'base-private',
    'local-private',
    'generated dependent',
    'generated dependency',
    'private-atomic-plugin-install-stack-v3',
    'option_value',
    'post_title',
    '__pluginOwner',
    'accessToken',
    'payload',
  ];

  for (const marker of forbiddenRawMarkers) {
    assert.equal(serialized.includes(marker), false, `${label} leaked raw marker ${marker}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
  assertEvidenceHashes(value);
}

test('RPP-0300 release verifier v5 carries atomic group blocker propagation proof', () => {
  const report = runGeneratedPushHarness();
  const targetCoverage = report.summary.targetCoverage[targetCoverageKey];

  assertReleaseVerifierTargetCoverage(targetCoverage, report);

  const firstFocusedEvidence = [focusedAtomicBlockerEvidence()];
  const replayFocusedEvidence = [focusedAtomicBlockerEvidence()];
  const firstGeneratedEvidence = generatedAtomicBlockerEvidence();
  const replayGeneratedEvidence = generatedAtomicBlockerEvidence();
  const focusedAggregate = aggregateAtomicBlockerEvidence(firstFocusedEvidence, null);
  const generatedAggregate = aggregateAtomicBlockerEvidence(firstGeneratedEvidence, targetCoverage);
  const releaseEvidenceEnvelope = {
    rpp: 'RPP-0300',
    evidenceSource: 'atomic-group-blocker-propagation-release-verifier-v5',
    status: 'support_only',
    evidenceScope: 'local-release-verifier',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    command,
    caveat,
    invariant:
      'atomic group source blockers propagate to every grouped mutation and non-ready plans refuse before partial mutation',
    focused: focusedAggregate,
    generated: {
      targetCoverage: generatedAggregate.targetCoverage,
      selectedCases: generatedAggregate.totalCases,
      statuses: generatedAggregate.statuses,
      perTier: generatedAggregate.perTier,
      totalBlockedGroups: generatedAggregate.totalBlockedGroups,
      totalGroupMutations: generatedAggregate.totalGroupMutations,
      totalGroupedPreconditions: generatedAggregate.totalGroupedPreconditions,
      totalDirectBlockers: generatedAggregate.totalDirectBlockers,
      totalPropagatedBlockers: generatedAggregate.totalPropagatedBlockers,
      sourceBlockerClasses: generatedAggregate.sourceBlockerClasses,
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
    'RPP-0300 focused release-verifier evidence changed between deterministic runs',
  );
  assert.deepEqual(
    firstGeneratedEvidence,
    replayGeneratedEvidence,
    'RPP-0300 generated release-verifier evidence changed between deterministic runs',
  );
  assertFocusedAggregate(focusedAggregate);
  assertGeneratedAggregate(generatedAggregate);
  assert.match(releaseEvidenceEnvelope.focusedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.generatedHash, sha256EvidencePattern);
  assert.match(releaseEvidenceEnvelope.aggregateHash, sha256EvidencePattern);
  assertHashOnlyEvidence(firstFocusedEvidence, 'RPP-0300 focused release-verifier evidence');
  assertHashOnlyEvidence(firstGeneratedEvidence, 'RPP-0300 generated release-verifier evidence');
  assertHashOnlyEvidence(releaseEvidenceEnvelope, 'RPP-0300 release-verifier envelope');
});
