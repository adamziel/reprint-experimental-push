import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
} from '../scripts/harness/generated-push-cases.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'basic' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
}

function assertMutationPreconditionOneToOne(plan, remote, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  const mutationsById = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(mutationsById.has(mutation.id), false, `${label} duplicate mutation id ${mutation.id}`);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${label} mutation resource key mismatch`);
    mutationsById.set(mutation.id, mutation);
  }

  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);

    const mutation = mutationsById.get(precondition.mutationId);
    assert.ok(mutation, `${label} orphan precondition ${precondition.mutationId}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource object mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(
      precondition.expectedHash,
      resourceHash(remote, mutation.resource),
      `${label} precondition must bind to the live remote resource hash`,
    );
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope mismatch`);
  }

  for (const mutation of plan.mutations) {
    assert.ok(
      preconditionsByMutationId.has(mutation.id),
      `${label} missing precondition for ${mutation.id}`,
    );
  }

  return preconditionsByMutationId;
}

function focusedFixtures() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';

  const readyBase = cloneJson(baseSite());
  const readyLocal = cloneJson(readyBase);
  const readyRemote = cloneJson(readyBase);
  readyLocal.files['index.php'] = '<?php echo "rpp0251-ready-file";';
  readyLocal.db.wp_posts['ID:1'].post_title = 'rpp0251 ready local post title';
  readyLocal.db.wp_options['option_name:forms_settings'].option_value.mode = 'rpp0251-ready-option-mode';
  readyLocal.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms'),
    ),
  };

  const conflictBase = cloneJson(baseSite());
  const conflictLocal = cloneJson(conflictBase);
  const conflictRemote = cloneJson(conflictBase);
  conflictLocal.files['index.php'] = '<?php echo "rpp0251-conflict-safe-file";';
  conflictLocal.db.wp_posts['ID:1'].post_title = 'rpp0251 local conflicting post title';
  conflictRemote.db.wp_posts['ID:1'].post_title = 'rpp0251 remote conflicting post title';

  const blockedBase = cloneJson(baseSite());
  const blockedLocal = cloneJson(blockedBase);
  const blockedRemote = cloneJson(blockedBase);
  blockedLocal.files['index.php'] = '<?php echo "rpp0251-blocked-safe-file";';
  blockedLocal.db.wp_posts['ID:1'].post_title = 'rpp0251 blocked local post title';
  blockedLocal.db.wp_options['option_name:forms_settings'].option_value.mode = 'rpp0251-blocked-option-mode';
  blockedLocal.pushIntents = [
    {
      id: 'rpp-0251-atomic-blocked-group',
      kind: 'change-set',
      requireAtomic: true,
      resources: [
        'file:index.php',
        'row:["wp_posts","ID:1"]',
        pluginOptionResourceKey,
      ],
    },
  ];

  return [
    {
      label: 'RPP-0251 ready mixed file row and plugin-owned option fixture',
      base: readyBase,
      local: readyLocal,
      remote: readyRemote,
      expectedStatus: 'ready',
      expectedMutationResourceKeys: [
        'file:index.php',
        'row:["wp_posts","ID:1"]',
        pluginOptionResourceKey,
      ],
      absentMutationResourceKeys: [],
    },
    {
      label: 'RPP-0251 conflict fixture keeps independent mutation mapped',
      base: conflictBase,
      local: conflictLocal,
      remote: conflictRemote,
      expectedStatus: 'conflict',
      expectedMutationResourceKeys: ['file:index.php'],
      absentMutationResourceKeys: ['row:["wp_posts","ID:1"]'],
    },
    {
      label: 'RPP-0251 blocked atomic fixture keeps emitted mutations mapped',
      base: blockedBase,
      local: blockedLocal,
      remote: blockedRemote,
      expectedStatus: 'blocked',
      expectedMutationResourceKeys: [
        'file:index.php',
        'row:["wp_posts","ID:1"]',
      ],
      absentMutationResourceKeys: [pluginOptionResourceKey],
    },
  ];
}

function planEvidenceFor(testCase, plan) {
  const preconditionsByMutationId = assertMutationPreconditionOneToOne(plan, testCase.planRemote, testCase.label);
  return {
    label: testCase.label,
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => {
      const precondition = preconditionsByMutationId.get(mutation.id);
      return {
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        preconditionResourceKey: precondition.resourceKey,
        expectedHash: precondition.expectedHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        checkedAgainst: precondition.checkedAgainst,
      };
    }).sort((left, right) => left.mutationId.localeCompare(right.mutationId)),
    preconditionMutationIds: plan.preconditions
      .map((precondition) => precondition.mutationId)
      .sort(),
  };
}

function collectGeneratedEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    totals: {
      mutations: 0,
      preconditions: 0,
    },
    readyCasesWithMutations: 0,
    nonReadyCasesWithMutations: 0,
    maxMutations: 0,
    familiesWithMutations: {},
    caseProofs: [],
  };

  for (const testCase of cases) {
    const plan = planFor(testCase.base, testCase.local, testCase.remote);
    const preconditionsByMutationId = assertMutationPreconditionOneToOne(
      plan,
      testCase.remote,
      `RPP-0251 generated ${testCase.id}`,
    );

    evidence.statuses[plan.status] = (evidence.statuses[plan.status] || 0) + 1;
    evidence.totals.mutations += plan.mutations.length;
    evidence.totals.preconditions += plan.preconditions.length;
    evidence.maxMutations = Math.max(evidence.maxMutations, plan.mutations.length);
    if (plan.mutations.length > 0) {
      evidence.familiesWithMutations[testCase.family] = (evidence.familiesWithMutations[testCase.family] || 0) + 1;
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
      mutationBindings: plan.mutations
        .map((mutation) => {
          const precondition = preconditionsByMutationId.get(mutation.id);
          return {
            mutationId: mutation.id,
            resourceKey: mutation.resourceKey,
            preconditionResourceKey: precondition.resourceKey,
            expectedHash: precondition.expectedHash,
            checkedAgainst: precondition.checkedAgainst,
          };
        })
        .sort((left, right) => left.mutationId.localeCompare(right.mutationId)),
    });
  }

  evidence.statuses = Object.fromEntries(Object.entries(evidence.statuses).sort());
  evidence.familiesWithMutations = Object.fromEntries(Object.entries(evidence.familiesWithMutations).sort());
  return evidence;
}

test('RPP-0251 focused fixtures keep mutations and live preconditions one-to-one', () => {
  const evidence = [];

  for (const fixture of focusedFixtures()) {
    const plan = planFor(fixture.base, fixture.local, fixture.remote);
    const replay = planFor(
      cloneJson(fixture.base),
      cloneJson(fixture.local),
      cloneJson(fixture.remote),
    );

    assert.equal(plan.status, fixture.expectedStatus, `${fixture.label} status`);
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

    for (const resourceKey of fixture.absentMutationResourceKeys) {
      assert.equal(
        plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
        false,
        `${fixture.label} emitted an unsafe mutation for ${resourceKey}`,
      );
      assert.equal(
        plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
        false,
        `${fixture.label} emitted an unsafe precondition for ${resourceKey}`,
      );
    }

    evidence.push(planEvidenceFor({ ...fixture, planRemote: fixture.remote }, plan));
    assert.deepEqual(
      planEvidenceFor({ ...fixture, planRemote: fixture.remote }, plan),
      planEvidenceFor({ ...fixture, planRemote: fixture.remote }, replay),
      `${fixture.label} mutation/precondition proof changed between deterministic runs`,
    );
  }

  assert.match(digest(evidence), /^[a-f0-9]{64}$/);
});

test('RPP-0251 generated fixtures keep every mutation mapped to exactly one live precondition', () => {
  const firstEvidence = collectGeneratedEvidence();
  const replayEvidence = collectGeneratedEvidence();

  assert.deepEqual(
    firstEvidence,
    replayEvidence,
    'RPP-0251 generated mutation/precondition evidence changed between deterministic runs',
  );
  assert.equal(firstEvidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(firstEvidence.totals.preconditions, firstEvidence.totals.mutations);
  assert.ok(firstEvidence.statuses.ready > 0, 'RPP-0251 generated proof needs ready cases');
  assert.ok(firstEvidence.statuses.conflict > 0, 'RPP-0251 generated proof needs conflict cases');
  assert.ok(firstEvidence.statuses.blocked > 0, 'RPP-0251 generated proof needs blocked cases');
  assert.ok(
    firstEvidence.readyCasesWithMutations > 0,
    'RPP-0251 generated proof needs ready cases with planned mutations',
  );
  assert.ok(
    firstEvidence.nonReadyCasesWithMutations > 0,
    'RPP-0251 generated proof needs non-ready cases with safe planned mutations',
  );
  assert.ok(firstEvidence.maxMutations >= 15, 'RPP-0251 generated proof needs high-mutation fixtures');
  assert.ok(
    Object.keys(firstEvidence.familiesWithMutations).length >= 20,
    'RPP-0251 generated proof should cover many mutation families',
  );
  assert.match(digest(firstEvidence), /^[a-f0-9]{64}$/);
});
