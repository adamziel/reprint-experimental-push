import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0378 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP 0378 base post',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
          guid: 'https://example.test/rpp-0378-base-post',
        },
      },
    },
  };
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function rowResource(table, id) {
  return { type: 'row', table, id, key: rowKey(table, id) };
}

function sourcePost({ id = 2001, guid, postName, title = 'local-private-rpp0378-source-title' }) {
  return {
    ID: id,
    post_title: title,
    post_name: postName,
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    guid,
  };
}

function childPost() {
  return {
    ID: 2002,
    post_title: 'local-private-rpp0378-child-title',
    post_name: 'local-private-rpp0378-child-slug',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 2001,
    post_author: 0,
    guid: 'https://example.test/local-private-rpp0378-child-guid',
  };
}

function buildReadyExplicitIdentityMapCase() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const sharedGuid = 'https://example.test/shared-private-rpp0378-mapped-guid';
  const sharedSlug = 'shared-private-rpp0378-mapped-slug';
  const sourcePostResourceKey = rowKey('wp_posts', 'ID:2001');
  const targetPostResourceKey = rowKey('wp_posts', 'ID:3001');
  const childPostResourceKey = rowKey('wp_posts', 'ID:2002');

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [{ table: 'wp_posts', localId: 'ID:2001', remoteId: 'ID:3001' }],
    },
  };
  local.db.wp_posts['ID:2001'] = sourcePost({
    guid: sharedGuid,
    postName: sharedSlug,
    title: 'local-private-rpp0378-mapped-title',
  });
  remote.db.wp_posts['ID:3001'] = sourcePost({
    id: 3001,
    guid: sharedGuid,
    postName: sharedSlug,
    title: 'local-private-rpp0378-mapped-title',
  });
  local.db.wp_posts['ID:2002'] = childPost();

  return {
    id: 'rpp-0378-ready-explicit-guid-slug-map',
    family: 'guid-slug-collision-handling-v4',
    variant: 'ready-explicit-identity-map',
    expectedStatus: 'ready',
    expectedOutcome: 'mapped-ready',
    expectedIdentityKinds: ['guid', 'post_type+post_name'],
    tags: new Set([
      'rpp-0378-guid-slug-collision-v4',
      'rpp-0378-guid-slug-collision-v4-ready',
      'guid-slug-explicit-identity-map',
      'generated-ready-case',
    ]),
    sourcePostResourceKey,
    targetPostResourceKey,
    childPostResourceKey,
    base,
    local,
    remote,
    secretTokens: [
      sharedGuid,
      sharedSlug,
      'local-private-rpp0378-mapped-title',
      'local-private-rpp0378-child-title',
      'local-private-rpp0378-child-slug',
      'https://example.test/local-private-rpp0378-child-guid',
    ],
  };
}

function buildStaleCollisionCase({ variant, localGuid, remoteGuid, localSlug, remoteSlug, expectedIdentityKinds }) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const sourcePostResourceKey = rowKey('wp_posts', 'ID:2001');
  const targetPostResourceKey = rowKey('wp_posts', 'ID:3001');

  local.db.wp_posts['ID:2001'] = sourcePost({
    guid: localGuid,
    postName: localSlug,
    title: `local-private-rpp0378-${variant}-title`,
  });
  remote.db.wp_posts['ID:3001'] = sourcePost({
    id: 3001,
    guid: remoteGuid,
    postName: remoteSlug,
    title: `remote-private-rpp0378-${variant}-title`,
  });

  return {
    id: `rpp-0378-stale-${variant}-collision`,
    family: 'guid-slug-collision-handling-v4',
    variant: `stale-${variant}-collision`,
    expectedStatus: 'blocked',
    expectedOutcome: 'collision-blocked',
    expectedIdentityKinds,
    tags: new Set([
      'rpp-0378-guid-slug-collision-v4',
      'rpp-0378-guid-slug-collision-v4-stale',
      'rpp-0378-guid-slug-collision-v4-non-ready',
      `guid-slug-${variant}-collision`,
      'generated-stale-case',
    ]),
    sourcePostResourceKey,
    targetPostResourceKey,
    childPostResourceKey: null,
    base,
    local,
    remote,
    secretTokens: [
      localGuid,
      remoteGuid,
      localSlug,
      remoteSlug,
      `local-private-rpp0378-${variant}-title`,
      `remote-private-rpp0378-${variant}-title`,
    ],
  };
}

function generateGuidSlugCollisionHarnessCases() {
  return [
    buildReadyExplicitIdentityMapCase(),
    buildStaleCollisionCase({
      variant: 'guid',
      localGuid: 'https://example.test/shared-private-rpp0378-guid-only',
      remoteGuid: 'https://example.test/shared-private-rpp0378-guid-only',
      localSlug: 'local-private-rpp0378-guid-only-slug',
      remoteSlug: 'remote-private-rpp0378-guid-only-slug',
      expectedIdentityKinds: ['guid'],
    }),
    buildStaleCollisionCase({
      variant: 'slug',
      localGuid: 'https://example.test/local-private-rpp0378-slug-only-guid',
      remoteGuid: 'https://example.test/remote-private-rpp0378-slug-only-guid',
      localSlug: 'shared-private-rpp0378-slug-only',
      remoteSlug: 'shared-private-rpp0378-slug-only',
      expectedIdentityKinds: ['post_type+post_name'],
    }),
    buildStaleCollisionCase({
      variant: 'guid-slug',
      localGuid: 'https://example.test/shared-private-rpp0378-both-guid',
      remoteGuid: 'https://example.test/shared-private-rpp0378-both-guid',
      localSlug: 'shared-private-rpp0378-both-slug',
      remoteSlug: 'shared-private-rpp0378-both-slug',
      expectedIdentityKinds: ['guid', 'post_type+post_name'],
    }),
  ];
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, label);
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
    `${label} summary must match emitted plan counts`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${label} precondition count`);
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation.resourceKey);
    assert.ok(precondition, `${label} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.mutationId, mutation.id, `${label} precondition mutation id`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(resourceHash(remote, mutation.resource), mutation.remoteBeforeHash, `${label} remote hash`);
    assertSha256(mutation.baseHash, `${label} ${mutation.resourceKey} baseHash`);
    assertSha256(mutation.localHash, `${label} ${mutation.resourceKey} localHash`);
    assertSha256(mutation.remoteBeforeHash, `${label} ${mutation.resourceKey} remoteBeforeHash`);
  }
}

function assertNoPrivateMarkers(value, secretTokens, label) {
  const serialized = JSON.stringify(value);
  for (const token of secretTokens) {
    assert.equal(serialized.includes(token), false, `${label} leaked raw marker ${token}`);
  }
}

function assertReadyMappedCase(testCase, plan) {
  const sourceDecision = decisionFor(plan, testCase.sourcePostResourceKey);
  const targetDecision = decisionFor(plan, testCase.targetPostResourceKey);
  const childMutation = mutationFor(plan, testCase.childPostResourceKey);

  assert.ok(sourceDecision, `${testCase.id} missing source decision`);
  assert.ok(targetDecision, `${testCase.id} missing target decision`);
  assert.ok(childMutation, `${testCase.id} missing child mutation`);

  const childValue = deserializeResourceValue(childMutation.value);
  const rewrite = childMutation.wordpressGraphIdentity.rewrites.find((entry) =>
    entry.relationshipType === 'post-parent');
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const staleRemote = cloneJson(testCase.remote);
  const staleInterloper = {
    ...testCase.local.db.wp_posts['ID:2002'],
    post_parent: 3001,
    post_title: 'stale-private-rpp0378-ready-child-interloper',
  };
  staleRemote.db.wp_posts['ID:2002'] = staleInterloper;
  const staleBefore = digest(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, plan));

  assert.equal(plan.status, 'ready', `${testCase.id} status`);
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, testCase.sourcePostResourceKey), undefined, `${testCase.id} source mutation`);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote', `${testCase.id} source decision`);
  assert.equal(targetDecision.decision, 'keep-remote', `${testCase.id} target decision`);
  assert.equal(childMutation.action, 'put', `${testCase.id} child action`);
  assert.equal(childMutation.changeKind, 'create', `${testCase.id} child change kind`);
  assert.equal(childValue.post_parent, 3001, `${testCase.id} rewritten child parent`);
  assert.ok(rewrite, `${testCase.id} missing post_parent rewrite evidence`);
  assert.equal(rewrite.sourceTargetResourceKey, testCase.sourcePostResourceKey);
  assert.equal(rewrite.targetResourceKey, testCase.targetPostResourceKey);
  assert.equal(rewrite.relationshipKey, 'wp_posts.post_parent');
  assertSha256(rewrite.sourceTargetLocalHash, `${testCase.id} rewrite source hash`);
  assertSha256(rewrite.targetRemoteHash, `${testCase.id} rewrite target hash`);
  assertEveryMutationHasLiveRemotePrecondition(plan, testCase.remote, testCase.id);

  assert.equal(applied.appliedMutations, 1, `${testCase.id} applied mutations`);
  assert.equal(applied.site.db.wp_posts['ID:2001'], undefined, `${testCase.id} source row should not be created`);
  assert.equal(applied.site.db.wp_posts['ID:2002'].post_parent, 3001, `${testCase.id} applied child parent`);
  assert.equal(
    resourceHash(applied.site, rowResource('wp_posts', 'ID:3001')),
    resourceHash(testCase.remote, rowResource('wp_posts', 'ID:3001')),
    `${testCase.id} changed mapped remote target`,
  );

  assert.ok(staleError instanceof PushPlanError, `${testCase.id} stale replay error`);
  assert.equal(staleError.code, 'PRECONDITION_FAILED', `${testCase.id} stale replay code`);
  assert.equal(digest(staleRemote), staleBefore, `${testCase.id} stale replay mutated remote`);
  assertNoPrivateMarkers(staleError.details, [staleInterloper.post_title], `${testCase.id} stale error`);

  const evidence = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    outcome: 'mapped-ready',
    sourceDecision: sourceDecision.decision,
    targetDecision: targetDecision.decision,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
    rewrite: {
      relationshipKey: rewrite.relationshipKey,
      relationshipType: rewrite.relationshipType,
      sourceTargetResourceKey: rewrite.sourceTargetResourceKey,
      targetResourceKey: rewrite.targetResourceKey,
      sourceTargetLocalHash: rewrite.sourceTargetLocalHash,
      targetRemoteHash: rewrite.targetRemoteHash,
    },
    childPostParent: childValue.post_parent,
    targetRemoteHash: resourceHash(testCase.remote, rowResource('wp_posts', 'ID:3001')),
    appliedMutations: applied.appliedMutations,
    staleReplay: {
      code: staleError.code,
      detailsHash: digest(staleError.details),
      remoteUnchanged: digest(staleRemote) === staleBefore,
    },
  };

  assertNoPrivateMarkers(evidence, testCase.secretTokens, `${testCase.id} ready evidence`);
  assertNoPrivateMarkers(evidence, [staleInterloper.post_title], `${testCase.id} stale evidence`);
  return { ...evidence, proofHash: digest(evidence) };
}

function assertStaleCollisionCase(testCase, plan) {
  const sourceMutation = mutationFor(plan, testCase.sourcePostResourceKey);
  const targetDecision = decisionFor(plan, testCase.targetPostResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === testCase.sourcePostResourceKey);
  const reference = blocker?.references[0];
  const remote = cloneJson(testCase.remote);
  const before = digest(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  assert.equal(plan.status, 'blocked', `${testCase.id} status`);
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(sourceMutation, undefined, `${testCase.id} source mutation`);
  assert.equal(preconditionFor(plan, testCase.sourcePostResourceKey), undefined, `${testCase.id} source precondition`);
  assert.equal(targetDecision.decision, 'keep-remote', `${testCase.id} target decision`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity', `${testCase.id} blocker class`);
  assert.match(blocker.reason, /collides with existing remote post identity/, `${testCase.id} blocker reason`);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(reference.relationshipKey, 'wp_posts.identity');
  assert.equal(reference.relationshipType, 'post-natural-identity-collision');
  assert.equal(reference.sourceResourceKey, testCase.sourcePostResourceKey);
  assert.equal(reference.targetResourceKey, testCase.targetPostResourceKey);
  assert.deepEqual(reference.identityKinds, testCase.expectedIdentityKinds);
  assert.equal(reference.targetRemoteHash, resourceHash(testCase.remote, rowResource('wp_posts', 'ID:3001')));
  for (const hash of [blocker.baseHash, blocker.localHash, blocker.remoteHash, reference.targetRemoteHash]) {
    assertSha256(hash, `${testCase.id} collision hash`);
  }

  assert.ok(error instanceof PushPlanError, `${testCase.id} refusal error`);
  assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} refusal code`);
  assert.equal(error.details.status, 'blocked', `${testCase.id} refusal status`);
  assert.equal(beforeMutationCalls, 0, `${testCase.id} beforeMutation calls`);
  assert.equal(digest(remote), before, `${testCase.id} refusal mutated remote`);
  assertNoPrivateMarkers(plan, testCase.secretTokens, `${testCase.id} blocked plan`);
  assertNoPrivateMarkers(error.details, testCase.secretTokens, `${testCase.id} refusal details`);

  const evidence = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    outcome: 'collision-blocked',
    targetDecision: targetDecision.decision,
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      resolutionPolicy: blocker.resolutionPolicy,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      reference: {
        relationshipKey: reference.relationshipKey,
        relationshipType: reference.relationshipType,
        sourceResourceKey: reference.sourceResourceKey,
        targetResourceKey: reference.targetResourceKey,
        identityKinds: reference.identityKinds,
        targetRemoteHash: reference.targetRemoteHash,
      },
    },
    refusal: {
      code: error.code,
      detailsHash: digest(error.details),
      beforeMutationCalls,
      remoteUnchanged: digest(remote) === before,
    },
  };

  assertNoPrivateMarkers(evidence, testCase.secretTokens, `${testCase.id} stale evidence`);
  return { ...evidence, proofHash: digest(evidence) };
}

function assertGuidSlugCollisionCase(testCase) {
  const plan = planFor(testCase);
  const replayPlan = planFor({
    ...testCase,
    base: cloneJson(testCase.base),
    local: cloneJson(testCase.local),
    remote: cloneJson(testCase.remote),
  });

  assertSummaryMatchesPlan(plan, testCase.id);
  assert.deepEqual(
    {
      status: plan.status,
      summary: plan.summary,
      mutations: plan.mutations.map((mutation) => ({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })),
      decisions: plan.decisions.map((decision) => ({
        resourceKey: decision.resourceKey,
        decision: decision.decision,
      })),
      blockers: plan.blockers.map((blocker) => ({
        resourceKey: blocker.resourceKey,
        class: blocker.class,
        references: blocker.references,
      })),
    },
    {
      status: replayPlan.status,
      summary: replayPlan.summary,
      mutations: replayPlan.mutations.map((mutation) => ({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })),
      decisions: replayPlan.decisions.map((decision) => ({
        resourceKey: decision.resourceKey,
        decision: decision.decision,
      })),
      blockers: replayPlan.blockers.map((blocker) => ({
        resourceKey: blocker.resourceKey,
        class: blocker.class,
        references: blocker.references,
      })),
    },
    `${testCase.id} deterministic replay evidence`,
  );

  if (testCase.expectedStatus === 'ready') {
    return assertReadyMappedCase(testCase, plan);
  }

  return assertStaleCollisionCase(testCase, plan);
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

test('RPP-0378 generated GUID and slug collision harness includes ready and stale cases', () => {
  const cases = generateGuidSlugCollisionHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.tags.has('rpp-0378-guid-slug-collision-v4-ready'));
  const staleCases = cases.filter((testCase) => testCase.tags.has('rpp-0378-guid-slug-collision-v4-stale'));

  assert.equal(cases.length, 4, 'RPP-0378 harness case count');
  assert.equal(readyCases.length, 1, 'RPP-0378 harness ready case count');
  assert.equal(staleCases.length, 3, 'RPP-0378 harness stale case count');
  assert.equal(
    cases.every((testCase) => testCase.tags.has('rpp-0378-guid-slug-collision-v4')),
    true,
    'every RPP-0378 case carries the target tag',
  );
  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'ready-explicit-identity-map',
    'stale-guid-collision',
    'stale-slug-collision',
    'stale-guid-slug-collision',
  ]);

  const results = cases.map(assertGuidSlugCollisionCase);
  const aggregateEvidence = {
    rpp: 'RPP-0378',
    successText: 'generated harness includes ready and stale cases',
    evidenceScope: 'local-focused-generated-harness',
    productionBacked: false,
    releaseGate: 'NO-GO',
    command: 'node --test test/rpp-0378-guid-slug-collision-handling-v4.test.js',
    generatedHarness: {
      totalCases: cases.length,
      readyCases: readyCases.length,
      staleCases: staleCases.length,
      variants: cases.map((testCase) => testCase.variant),
      tags: [...new Set(cases.flatMap((testCase) => [...testCase.tags]))].sort(),
    },
    statuses: countBy(results, (result) => result.status),
    outcomes: countBy(results, (result) => result.outcome),
    identityKindCoverage: countBy(
      cases.flatMap((testCase) => testCase.expectedIdentityKinds.map((kind) => `${testCase.variant}:${kind}`)),
      (key) => key,
    ),
    proofHashes: results.map((result) => result.proofHash),
    resultHash: digest(results),
    results,
  };

  assert.deepEqual(aggregateEvidence.statuses, { blocked: 3, ready: 1 });
  assert.deepEqual(aggregateEvidence.outcomes, { 'collision-blocked': 3, 'mapped-ready': 1 });
  assert.equal(aggregateEvidence.identityKindCoverage['stale-guid-collision:guid'], 1);
  assert.equal(aggregateEvidence.identityKindCoverage['stale-slug-collision:post_type+post_name'], 1);
  assert.equal(aggregateEvidence.identityKindCoverage['stale-guid-slug-collision:guid'], 1);
  assert.equal(aggregateEvidence.identityKindCoverage['stale-guid-slug-collision:post_type+post_name'], 1);
  for (const proofHash of aggregateEvidence.proofHashes) {
    assertSha256(proofHash, 'RPP-0378 case proof hash');
  }
  assertSha256(aggregateEvidence.resultHash, 'RPP-0378 aggregate result hash');
  assertNoPrivateMarkers(
    aggregateEvidence,
    cases.flatMap((testCase) => testCase.secretTokens),
    'RPP-0378 aggregate evidence',
  );
});
