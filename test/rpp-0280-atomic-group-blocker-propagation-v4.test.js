import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedFocusedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0280 base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': {
          option_name: 'blogname',
          option_value: 'RPP 0280 Base',
        },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'RPP 0280 base post', post_status: 'publish' },
      },
    },
  };
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

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedFocusedNow });
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

function assertSummaryMatchesPlan(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary must match emitted evidence`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
  }

  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} must emit exactly one live-remote precondition per mutation`,
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} mutation ${mutation.resourceKey} remote hash`,
    );
    assertSha256Hex(mutation.baseHash, `${label} mutation ${mutation.resourceKey} base hash`);
    assertSha256Hex(mutation.localHash, `${label} mutation ${mutation.resourceKey} local hash`);
    assertSha256Hex(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remote hash`);
  }
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '8'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function assertBlockedApplyStopsBeforeMutation(plan, remote, label) {
  const applyRemote = cloneJson(remote);
  const beforeRemoteHash = digest(applyRemote);
  const journalEvents = [];
  let beforeMutationCalls = 0;
  let result = null;
  const error = captureError(() => {
    result = applyPlan(applyRemote, plan, {
      durableJournal: claimFencedDurableJournal(journalEvents),
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  });

  assert.ok(error instanceof PushPlanError, `${label} should throw PushPlanError`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${label} refusal code`);
  assert.deepEqual(error.details, { status: 'blocked' }, `${label} refusal details`);
  assert.equal(result, null, `${label} returned an apply result`);
  assert.equal(beforeMutationCalls, 0, `${label} reached mutation callback`);
  assert.deepEqual(journalEvents, [], `${label} wrote durable journal events`);
  assert.equal(digest(applyRemote), beforeRemoteHash, `${label} mutated remote snapshot`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    durableJournalEventCount: journalEvents.length,
    beforeMutationCalls,
    appliedMutationCount: 0,
  };
}

function assertNoRawValues(value, forbiddenValues, label) {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, `${label} leaked raw value ${forbiddenValue}`);
  }
}

test('RPP-0280 propagates combined atomic group blockers before mutation, variant 4', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const groupId = 'rpp-0280-atomic-blocked-group';
  const homeResourceKey = 'file:index.php';
  const dependentFileResourceKey = `file:${pluginMainFile(atomicDependentPlugin)}`;
  const dependentPluginResourceKey = `plugin:${atomicDependentPlugin}`;
  const unsupportedRowResourceKey = rowKey('wp_options', 'option_name:forms_settings');
  const privateValues = [
    '<?php echo "local-private-rpp0280-home";',
    '<?php /* local-private-rpp0280-dependent-plugin */',
    'local-private-rpp0280-option-mode',
    'local-private-rpp0280-dependency-token',
  ];

  local.files['index.php'] = privateValues[0];
  local.files[pluginMainFile(atomicDependentPlugin)] = privateValues[1];
  local.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[2];
  local.pushIntents = [
    {
      id: groupId,
      kind: 'plugin-install',
      label: 'RPP-0280 atomic blocked group',
      requireAtomic: true,
      resources: [
        homeResourceKey,
        dependentFileResourceKey,
        dependentPluginResourceKey,
        unsupportedRowResourceKey,
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            expectedVersion: '2.1.0',
            active: true,
            accessToken: privateValues[3],
          },
        ],
      },
    },
  ];

  const plan = planFor(base, local, remote);
  const group = plan.atomicGroups.find((entry) => entry.id === groupId);
  const directBlockers = group.blockers
    .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation')
    .sort((a, b) => a.id.localeCompare(b.id));
  const propagatedBlockers = group.blockers
    .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
  const groupMutations = plan.mutations
    .filter((mutation) => group.mutationIds.includes(mutation.id))
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
  const directBlockerIds = directBlockers.map((blocker) => blocker.id).sort();
  const refusal = assertBlockedApplyStopsBeforeMutation(plan, remote, 'RPP-0280 focused atomic group');
  const evidence = {
    rpp: 'RPP-0280',
    behavior: 'atomic group blocker propagation, variant 4',
    progressLog: {
      command: 'node --test test/rpp-0280-atomic-group-blocker-propagation-v4.test.js',
      caveat: 'Focused local Node planner/apply proof only; release remains gated separately.',
    },
    status: plan.status,
    summary: plan.summary,
    group: {
      id: group.id,
      kind: group.kind,
      status: group.status,
      resources: [...group.resources].sort(),
      mutationIds: [...group.mutationIds].sort(),
      dependencies: group.dependencies,
      dependencyRequirements: group.dependencyRequirements.map((requirement) => ({
        plugin: requirement.plugin,
        expectedVersion: requirement.expectedVersion,
        active: requirement.active,
        source: requirement.source,
        resourceKey: requirement.resourceKey,
        requirementHash: `sha256:${digest(requirement)}`,
      })),
      directBlockers: directBlockers.map((blocker) => ({
        id: blocker.id,
        class: blocker.class,
        groupId: blocker.groupId || null,
        resourceKey: blocker.resourceKey || null,
        plugin: blocker.plugin || null,
        pluginOwner: blocker.pluginOwner || null,
        reasonCode: blocker.reasonCode || null,
        baseHash: blocker.baseHash || null,
        localHash: blocker.localHash || null,
        remoteHash: blocker.remoteHash || null,
        blockerHash: `sha256:${digest(blocker)}`,
      })),
      propagatedBlockers: propagatedBlockers.map((blocker) => ({
        id: blocker.id,
        class: blocker.class,
        groupId: blocker.groupId,
        mutationId: blocker.mutationId,
        resourceKey: blocker.resourceKey,
        sourceBlockerIds: [...blocker.sourceBlockerIds].sort(),
        blockerHash: `sha256:${digest(blocker)}`,
      })),
    },
    mutations: groupMutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      atomicGroupId: mutation.atomicGroupId,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })),
    refusal,
    evidenceHash: null,
  };
  evidence.evidenceHash = `sha256:${digest(evidence)}`;

  assert.equal(plan.status, 'blocked', 'RPP-0280 plan status');
  assert.equal(group.status, 'blocked', 'RPP-0280 group status');
  assertSummaryMatchesPlan(plan, 'RPP-0280 focused atomic group');
  assert.equal(plan.conflicts.length, 0, 'RPP-0280 conflict count');
  assert.equal(plan.summary.blockers, 5, 'RPP-0280 blocker count');
  assert.equal(groupMutations.length, 3, 'RPP-0280 grouped mutation count');
  assert.deepEqual(
    groupMutations.map((mutation) => mutation.resourceKey),
    [dependentFileResourceKey, homeResourceKey, dependentPluginResourceKey].sort(),
    'RPP-0280 grouped mutation keys',
  );
  assert.equal(mutationFor(plan, unsupportedRowResourceKey), undefined, 'RPP-0280 unsupported row mutation');
  assert.equal(preconditionFor(plan, unsupportedRowResourceKey), undefined, 'RPP-0280 unsupported row precondition');
  assert.deepEqual(
    directBlockers.map((blocker) => blocker.class).sort(),
    ['missing-plugin-dependency', 'unsupported-plugin-owned-resource'],
    'RPP-0280 direct blocker classes',
  );
  assert.equal(
    directBlockers.find((blocker) => blocker.class === 'missing-plugin-dependency').dependency.accessToken,
    undefined,
    'RPP-0280 dependency blocker must redact private dependency fields',
  );
  assert.deepEqual(
    propagatedBlockers.map((blocker) => blocker.resourceKey),
    groupMutations.map((mutation) => mutation.resourceKey),
    'RPP-0280 propagation must cover every grouped mutation',
  );
  assert.deepEqual(
    propagatedBlockers.map((blocker) => [...blocker.sourceBlockerIds].sort()),
    groupMutations.map(() => directBlockerIds),
    'RPP-0280 propagation must reference every source blocker',
  );
  assert.deepEqual(
    propagatedBlockers.map((blocker) => blocker.mutationId),
    groupMutations.map((mutation) => mutation.id),
    'RPP-0280 propagated blockers must bind to mutation ids',
  );
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, 'RPP-0280 focused atomic group');
  for (const mutation of groupMutations) {
    assert.equal(mutation.atomicGroupId, groupId, `RPP-0280 mutation ${mutation.resourceKey} group id`);
  }
  for (const hash of [
    ...evidence.group.directBlockers.flatMap((blocker) =>
      [blocker.baseHash, blocker.localHash, blocker.remoteHash, blocker.blockerHash].filter(Boolean)),
    ...evidence.group.dependencyRequirements.map((requirement) => requirement.requirementHash),
    ...evidence.group.propagatedBlockers.map((blocker) => blocker.blockerHash),
    evidence.refusal.detailsHash,
    evidence.evidenceHash,
  ]) {
    assert.match(hash, hash.startsWith('sha256:') ? sha256EvidencePattern : sha256HexPattern);
  }
  assertNoRawValues(evidence, privateValues, 'RPP-0280 focused evidence');
});
