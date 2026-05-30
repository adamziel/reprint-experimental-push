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

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

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
      'index.php': '<?php echo "base rpp0271";',
      'wp-content/themes/reprint/style.css': '/* base theme rpp0271 */',
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base RPP-0271' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base', limit: 1 },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base RPP-0271 post', post_status: 'publish' },
      },
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option') {
  return { pluginOwner, resourceKey, driver };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function readyMixedFocusedFixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0271 file update";';
  local.files['wp-content/uploads/rpp-0271-local-create.txt'] = 'local rpp0271 file create';
  delete local.files['wp-content/themes/reprint/style.css'];
  local.db.wp_posts['ID:1'].post_title = 'Local RPP-0271 post update';
  local.db.wp_options['option_name:forms_settings'].option_value = {
    mode: 'local-rpp0271',
    limit: 2,
  };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms'),
    ),
  };

  return {
    label: 'RPP-0271 focused ready mixed update/create/delete/plugin-row fixture',
    base,
    local,
    remote,
    expectedStatus: 'ready',
    expectedMutationResourceKeys: [
      'file:index.php',
      'file:wp-content/themes/reprint/style.css',
      'file:wp-content/uploads/rpp-0271-local-create.txt',
      'row:["wp_options","option_name:forms_settings"]',
      'row:["wp_posts","ID:1"]',
    ],
    absentMutationResourceKeys: [],
    staleReplayResourceKey: 'row:["wp_posts","ID:1"]',
  };
}

function conflictWithIndependentMutationFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0271 independent conflict fixture";';
  local.db.wp_posts['ID:1'].post_title = 'Local RPP-0271 conflicting title';
  remote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0271 conflicting title';

  return {
    label: 'RPP-0271 focused conflict plus independent safe mutation fixture',
    base,
    local,
    remote,
    expectedStatus: 'conflict',
    expectedMutationResourceKeys: ['file:index.php'],
    absentMutationResourceKeys: ['row:["wp_posts","ID:1"]'],
  };
}

function blockedAtomicPropagationFixture() {
  const blockedResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local rpp0271 atomic file";';
  local.db.wp_posts['ID:1'].post_title = 'Local RPP-0271 atomic post';
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-rpp0271-blocked-plugin-row';
  local.pushIntents = [
    {
      id: 'rpp-0271-atomic-blocked-group',
      kind: 'change-set',
      requireAtomic: true,
      resources: [
        'file:index.php',
        'row:["wp_posts","ID:1"]',
        blockedResourceKey,
      ],
    },
  ];

  return {
    label: 'RPP-0271 focused blocked atomic propagation fixture',
    base,
    local,
    remote,
    expectedStatus: 'blocked',
    expectedMutationResourceKeys: [
      'file:index.php',
      'row:["wp_posts","ID:1"]',
    ],
    absentMutationResourceKeys: [blockedResourceKey],
    expectedAtomicGroupId: 'rpp-0271-atomic-blocked-group',
  };
}

function focusedFixtures() {
  return [
    readyMixedFocusedFixture(),
    conflictWithIndependentMutationFixture(),
    blockedAtomicPropagationFixture(),
  ];
}

function incrementCount(map, key) {
  map[key] = (map[key] || 0) + 1;
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
}

function mutationPreconditionEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutationResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    preconditionResourceKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
    mutationIds: plan.mutations.map((mutation) => mutation.id).sort(),
    preconditionMutationIds: plan.preconditions.map((precondition) => precondition.mutationId).sort(),
    preconditionHash: `sha256:${digest(plan.preconditions)}`,
    mutationHash: `sha256:${digest(plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      atomicGroupId: mutation.atomicGroupId,
    })))}`,
  };
}

function assertFocusedReadyApplyAndStaleReplay(fixture, plan) {
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
  driftedRemote.db.wp_posts['ID:1'].post_title = 'Remote RPP-0271 stale replay drift';
  const remoteBeforeHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan));

  assert.ok(error instanceof PushPlanError, `${fixture.label} stale replay should fail with PushPlanError`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(digest(driftedRemote), remoteBeforeHash, `${fixture.label} stale replay mutated the remote`);
  assert.equal(error.details.resourceKey, staleMutation.resourceKey);
  assert.equal(error.details.expectedHash, stalePrecondition.expectedHash);
}

function generatedMutationPreconditionEvidence() {
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
    proofs: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedNow,
    });
    const label = `RPP-0271 generated ${testCase.id}`;

    assertMutationPreconditionOneToOne({ label, remote: testCase.remote, plan });
    incrementCount(evidence.statuses, plan.status);
    evidence.totals.mutations += plan.mutations.length;
    evidence.totals.preconditions += plan.preconditions.length;
    evidence.maxMutations = Math.max(evidence.maxMutations, plan.mutations.length);
    if (plan.mutations.length > 0) {
      if (plan.status === 'ready') {
        evidence.readyCasesWithMutations += 1;
      } else {
        evidence.nonReadyCasesWithMutations += 1;
      }
    }
    evidence.proofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      mutationResourceKeySetHash: `sha256:${digest(plan.mutations.map((mutation) => mutation.resourceKey).sort())}`,
      preconditionResourceKeySetHash: `sha256:${digest(plan.preconditions.map((precondition) => precondition.resourceKey).sort())}`,
      mutationIdSetHash: `sha256:${digest(plan.mutations.map((mutation) => mutation.id).sort())}`,
      preconditionMutationIdSetHash: `sha256:${digest(plan.preconditions.map((precondition) => precondition.mutationId).sort())}`,
    });
  }

  return evidence;
}

test('RPP-0271 focused variant 4 fixtures keep mutations and preconditions one-to-one', () => {
  for (const fixture of focusedFixtures()) {
    const plan = planFor(fixture.base, fixture.local, fixture.remote);
    const replay = planFor(
      cloneJson(fixture.base),
      cloneJson(fixture.local),
      cloneJson(fixture.remote),
    );

    assert.equal(plan.status, fixture.expectedStatus, `${fixture.label} status`);
    assert.deepEqual(plan.summary, {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    }, `${fixture.label} summary counts`);
    assertMutationPreconditionOneToOne({ label: fixture.label, remote: fixture.remote, plan });
    assert.deepEqual(
      plan.mutations.map((mutation) => mutation.resourceKey).sort(),
      [...fixture.expectedMutationResourceKeys].sort(),
      `${fixture.label} mutation resource set`,
    );
    assert.deepEqual(
      plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
      [...fixture.expectedMutationResourceKeys].sort(),
      `${fixture.label} precondition resource set`,
    );
    assert.deepEqual(
      mutationPreconditionEvidence(plan),
      mutationPreconditionEvidence(replay),
      `${fixture.label} evidence changed between deterministic runs`,
    );

    for (const resourceKey of fixture.absentMutationResourceKeys) {
      assert.equal(
        plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
        false,
        `${fixture.label} emitted an unsafe mutation for ${resourceKey}`,
      );
      assert.equal(
        plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
        false,
        `${fixture.label} emitted an extra precondition for ${resourceKey}`,
      );
    }

    if (fixture.expectedAtomicGroupId) {
      const group = plan.atomicGroups.find((entry) => entry.id === fixture.expectedAtomicGroupId);
      const propagatedBlockers = plan.blockers.filter(
        (blocker) => blocker.class === 'atomic-group-blocker-propagation',
      );

      assert.equal(group?.status, 'blocked', `${fixture.label} atomic group status`);
      assert.deepEqual(
        propagatedBlockers.map((blocker) => blocker.mutationId).sort(),
        plan.mutations.map((mutation) => mutation.id).sort(),
        `${fixture.label} propagated blockers should point at emitted mutations`,
      );
    }

    if (fixture.expectedStatus === 'ready') {
      assertFocusedReadyApplyAndStaleReplay(fixture, plan);
    }
  }
});

test('RPP-0271 generated variant 4 cases keep mutations and preconditions one-to-one', () => {
  const firstEvidence = generatedMutationPreconditionEvidence();
  const replayEvidence = generatedMutationPreconditionEvidence();

  assert.deepEqual(
    firstEvidence,
    replayEvidence,
    'RPP-0271 generated mutation/precondition evidence changed between runs',
  );
  assert.equal(firstEvidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(firstEvidence.totals.preconditions, firstEvidence.totals.mutations);
  assert.ok(firstEvidence.statuses.ready > 0, 'RPP-0271 generated proof needs ready cases');
  assert.ok(firstEvidence.statuses.conflict > 0, 'RPP-0271 generated proof needs conflict cases');
  assert.ok(firstEvidence.statuses.blocked > 0, 'RPP-0271 generated proof needs blocked cases');
  assert.ok(
    firstEvidence.readyCasesWithMutations > 0,
    'RPP-0271 generated proof needs ready cases with planned mutations',
  );
  assert.ok(
    firstEvidence.nonReadyCasesWithMutations > 0,
    'RPP-0271 generated proof needs non-ready cases that still emit safe planned mutations',
  );
  assert.ok(firstEvidence.maxMutations >= 15, 'RPP-0271 generated proof needs high-mutation fixtures');

  for (const proof of firstEvidence.proofs) {
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
  }
});
