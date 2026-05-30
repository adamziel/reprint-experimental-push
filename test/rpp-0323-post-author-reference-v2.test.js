import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const readyFamily = 'same-plan-post-author-graph';
const staleFamily = 'stale-post-author-graph';
const rawMarkers = Object.freeze([
  /post-author-reference-\d/,
  /post-author-target-\d/,
  'Generated post author target',
  'Remote stale post author',
  'remote-private-post-author',
  'RPP-0323 stale replay drift',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, rowId) {
  return `row:${JSON.stringify([table, rowId])}`;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected callback to throw');
}

function postAuthorCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('post-author-graph'));
}

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((entry) => entry.mutationId === mutation?.id) || null;
}

function assertPostAuthorShape(testCase, { staleTarget }) {
  const authoredRows = Object.entries(testCase.local.db.wp_posts || {})
    .filter(([, row]) => String(row.post_title || '').startsWith('post-author-reference-'));

  assert.equal(authoredRows.length, 1, `${testCase.id} should contain one generated authored post`);

  const [postRowId, postRow] = authoredRows[0];
  const userId = Number(postRow.post_author);
  const userRowId = `ID:${userId}`;
  const localUser = testCase.local.db.wp_users?.[userRowId];

  assert.ok(Number.isSafeInteger(userId), `${testCase.id} should use a numeric post_author`);
  assert.equal(postRowId, `ID:${postRow.ID}`);
  assert.ok(localUser, `${testCase.id} should contain the post_author wp_users target`);
  assert.equal(localUser.ID, userId);

  if (staleTarget) {
    assert.deepEqual(
      testCase.local.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale local author should match base`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale remote author should drift`,
    );
  } else {
    assert.equal(testCase.base.db.wp_users?.[userRowId], undefined);
    assert.equal(testCase.remote.db.wp_users?.[userRowId], undefined);
  }

  return {
    userId,
    userRowId,
    postRowId,
    userResourceKey: rowResourceKey('wp_users', userRowId),
    postResourceKey: rowResourceKey('wp_posts', postRowId),
  };
}

function readyEvidence(testCase, plan, result, shape) {
  const userMutation = mutationFor(plan, shape.userResourceKey);
  const postMutation = mutationFor(plan, shape.postResourceKey);
  const userPrecondition = preconditionFor(plan, userMutation);
  const postPrecondition = preconditionFor(plan, postMutation);
  const plannedPost = deserializeResourceValue(postMutation.value);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const staleReplay = readyStaleReplayEvidence(testCase, plan, shape);

  assert.equal(plan.status, 'ready');
  assert.equal(result.status, 'ready');
  assert.equal(result.applied, true);
  assert.equal(result.unplannedRemotePreserved, true);
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
  assert.ok(userMutation, `${testCase.id} should plan the same-plan wp_users author row`);
  assert.ok(postMutation, `${testCase.id} should plan the authored wp_posts row`);
  assert.equal(userMutation.changeKind, 'create');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(plannedPost.post_author, shape.userId);
  assert.ok(userPrecondition, `${testCase.id} should precondition the author row`);
  assert.ok(postPrecondition, `${testCase.id} should precondition the authored post`);
  assert.equal(userPrecondition.checkedAgainst, 'live-remote');
  assert.equal(postPrecondition.checkedAgainst, 'live-remote');
  assert.equal(userPrecondition.expectedHash, userMutation.remoteBeforeHash);
  assert.equal(postPrecondition.expectedHash, postMutation.remoteBeforeHash);
  assert.deepEqual(applied.site.db.wp_users[shape.userRowId], testCase.local.db.wp_users[shape.userRowId]);
  assert.deepEqual(applied.site.db.wp_posts[shape.postRowId], testCase.local.db.wp_posts[shape.postRowId]);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    staleReplayRejected: result.staleReplayRejected,
    staleReplayRejectionCode: result.staleReplayRejectionCode,
    staleReplayBeforeMutation: staleReplay.beforeMutationCalls === 0,
    graphReference: {
      relationshipKey: 'wp_posts.post_author',
      relationshipType: 'post-author',
      sourceResourceKey: shape.postResourceKey,
      targetResourceKey: shape.userResourceKey,
      targetTable: 'wp_users',
      targetId: shape.userRowId,
    },
    mutationProof: {
      userChangeKind: userMutation.changeKind,
      postChangeKind: postMutation.changeKind,
      userPreconditionLive: userPrecondition.checkedAgainst === 'live-remote',
      postPreconditionLive: postPrecondition.checkedAgainst === 'live-remote',
      userMutationHash: sha256Evidence(userMutation),
      postMutationHash: sha256Evidence(postMutation),
      journalHash: sha256Evidence(applied.journal),
    },
    staleReplay,
  };
}

function readyStaleReplayEvidence(testCase, plan, shape) {
  const driftedRemote = cloneJson(testCase.remote);
  driftedRemote.db.wp_users ||= {};
  driftedRemote.db.wp_users[shape.userRowId] = {
    ...testCase.local.db.wp_users[shape.userRowId],
    display_name: 'RPP-0323 stale replay drift',
  };
  const staleRemoteHash = digest(driftedRemote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(driftedRemote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(beforeMutationCalls, 0, `${testCase.id} stale replay should refuse before mutation`);
  assert.equal(remoteAfterHash, staleRemoteHash, `${testCase.id} stale replay should not mutate remote`);

  return {
    code: error.code,
    resourceKey: error.details?.resourceKey || null,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteUnchanged: remoteAfterHash === staleRemoteHash,
    staleRemoteHash,
    remoteAfterHash,
    detailsHash: sha256Evidence(error.details || {}),
  };
}

function staleEvidence(testCase, plan, result, shape) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.postResourceKey);
  const reference = blocker?.references?.find((entry) =>
    entry.relationshipType === 'post-author');
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteAfterHash = digest(remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(result.status, 'blocked');
  assert.equal(result.applied, false);
  assert.equal(result.nonReadyRemoteUnchanged, true);
  assert.equal(mutationFor(plan, shape.postResourceKey), null, `${testCase.id} must not plan the stale authored post`);
  assert.ok(blocker, `${testCase.id} should block the stale post_author reference`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(reference, `${testCase.id} should include post_author reference evidence`);
  assert.equal(reference.relationshipKey, 'wp_posts.post_author');
  assert.equal(reference.sourceResourceKey, shape.postResourceKey);
  assert.equal(reference.targetResourceKey, shape.userResourceKey);
  assert.equal(reference.targetTable, 'wp_users');
  assert.equal(reference.targetId, shape.userRowId);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.match(reference.targetBaseHash, sha256Pattern);
  assert.match(reference.targetLocalHash, sha256Pattern);
  assert.match(reference.targetRemoteHash, sha256Pattern);
  assert.notEqual(reference.targetRemoteHash, reference.targetBaseHash);
  assert.equal(reference.targetLocalHash, reference.targetBaseHash);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(remoteAfterHash, remoteBeforeHash);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    applied: false,
    refusal: {
      code: error.code,
      beforeMutationCalls,
      preMutationRefusal: beforeMutationCalls === 0,
      remoteBeforeHash,
      remoteAfterHash,
      remoteUnchanged: remoteAfterHash === remoteBeforeHash,
      detailsHash: sha256Evidence(error.details || {}),
    },
    graphReference: {
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      sourceResourceKey: reference.sourceResourceKey,
      targetResourceKey: reference.targetResourceKey,
      targetTable: reference.targetTable,
      targetId: reference.targetId,
      targetBaseHash: reference.targetBaseHash,
      targetLocalHash: reference.targetLocalHash,
      targetRemoteHash: reference.targetRemoteHash,
      targetChangeHash: sha256Evidence(reference.targetChange),
    },
    blockerHash: sha256Evidence(blocker),
  };
}

function buildRpp0323Evidence() {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postAuthorGraph;
  const readyCases = [];
  const staleCases = [];
  const perTier = {};

  assert.ok(coverage, 'missing post author generated target coverage');
  assert.equal(coverage.family, readyFamily);

  for (const testCase of postAuthorCases()) {
    const staleTarget = testCase.family === staleFamily;
    const shape = assertPostAuthorShape(testCase, { staleTarget });
    const plan = planFor(testCase);
    const result = validateGeneratedCase(testCase);
    const entry = staleTarget
      ? staleEvidence(testCase, plan, result, shape)
      : readyEvidence(testCase, plan, result, shape);

    perTier[testCase.tier] = (perTier[testCase.tier] || 0) + 1;
    if (staleTarget) {
      staleCases.push(entry);
    } else {
      readyCases.push(entry);
    }
  }

  assert.equal(readyCases.length, 10);
  assert.equal(staleCases.length, 10);
  assert.deepEqual(coverage.statuses, { blocked: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, Object.fromEntries(
    Array.from({ length: 10 }, (_, tier) => [String(tier), 2]),
  ));
  assert.deepEqual(
    Object.fromEntries(Object.entries(perTier).sort(([left], [right]) => Number(left) - Number(right))),
    coverage.perTier,
  );

  const evidence = {
    rpp: 'RPP-0323',
    evidenceSource: 'generated-post-author-reference-v2',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    coverage: {
      key: 'postAuthorGraph',
      family: coverage.family,
      total: coverage.total,
      statuses: coverage.statuses,
      perTier: coverage.perTier,
    },
    aggregate: {
      readyCases: readyCases.length,
      staleCases: staleCases.length,
      readyStaleReplayRejected: readyCases.filter((entry) => entry.staleReplayRejected).length,
      readyStaleReplayBeforeMutation: readyCases.filter((entry) => entry.staleReplayBeforeMutation).length,
      stalePlanRefused: staleCases.filter((entry) => entry.refusal.code === 'PLAN_NOT_READY').length,
      staleBeforeMutation: staleCases.filter((entry) => entry.refusal.beforeMutationCalls === 0).length,
    },
    selectedCases: [
      readyCases[0],
      staleCases[0],
    ],
  };

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function assertNoRawMarkers(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const marker of rawMarkers) {
    const leaked = marker instanceof RegExp ? marker.test(serialized) : serialized.includes(marker);
    assert.equal(leaked, false, `RPP-0323 evidence leaked ${String(marker)}`);
  }
}

test('RPP-0323 generated harness proves post author ready and stale cases', () => {
  const evidence = buildRpp0323Evidence();
  const replay = buildRpp0323Evidence();

  assert.deepEqual(evidence, replay, 'RPP-0323 generated post author evidence should be deterministic');
  assert.equal(evidence.rpp, 'RPP-0323');
  assert.equal(evidence.evidenceSource, 'generated-post-author-reference-v2');
  assert.deepEqual(evidence.aggregate, {
    readyCases: 10,
    staleCases: 10,
    readyStaleReplayRejected: 10,
    readyStaleReplayBeforeMutation: 10,
    stalePlanRefused: 10,
    staleBeforeMutation: 10,
  });
  assert.match(evidence.proofHash, sha256EvidencePattern);

  const [ready, stale] = evidence.selectedCases;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.graphReference.relationshipKey, 'wp_posts.post_author');
  assert.equal(ready.graphReference.targetTable, 'wp_users');
  assert.equal(ready.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplay.beforeMutationCalls, 0);
  assert.equal(ready.staleReplay.preMutationRefusal, true);
  assert.match(ready.mutationProof.userMutationHash, sha256EvidencePattern);
  assert.match(ready.mutationProof.postMutationHash, sha256EvidencePattern);
  assert.match(ready.mutationProof.journalHash, sha256EvidencePattern);

  assert.equal(stale.status, 'blocked');
  assert.equal(stale.graphReference.relationshipKey, 'wp_posts.post_author');
  assert.equal(stale.graphReference.targetTable, 'wp_users');
  assert.equal(stale.refusal.code, 'PLAN_NOT_READY');
  assert.equal(stale.refusal.beforeMutationCalls, 0);
  assert.equal(stale.refusal.remoteUnchanged, true);
  assert.match(stale.graphReference.targetBaseHash, sha256Pattern);
  assert.match(stale.graphReference.targetLocalHash, sha256Pattern);
  assert.match(stale.graphReference.targetRemoteHash, sha256Pattern);
  assert.match(stale.blockerHash, sha256EvidencePattern);

  assertNoRawMarkers(evidence);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0323 post author generated-harness evidence' }));
});
