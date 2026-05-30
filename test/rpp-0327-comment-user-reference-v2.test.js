import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T03:27:00.000Z');
const commentResourceKey = 'row:["wp_comments","comment_ID:3272"]';
const userResourceKey = 'row:["wp_users","ID:327"]';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const privateFixtures = Object.freeze([
  'local-private-rpp0327-comment-user-body',
  'base-private-rpp0327-unsupported-user',
  'base-private-rpp0327-unsupported-user@example.test',
  'Base Private RPP-0327 Unsupported User',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0327-base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0327 base post',
          post_status: 'publish',
        },
      },
      wp_users: {
        'ID:327': {
          // The row key says ID:327, but the row payload does not prove that
          // WordPress user identity. A comment user_id reference must stop.
          ID: 328,
          user_login: 'base-private-rpp0327-unsupported-user',
          user_email: 'base-private-rpp0327-unsupported-user@example.test',
          display_name: 'Base Private RPP-0327 Unsupported User',
        },
      },
      wp_comments: {},
    },
  };
}

function commentUserFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_comments['comment_ID:3272'] = {
    comment_ID: 3272,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 327,
    comment_content: 'local-private-rpp0327-comment-user-body',
  };

  return { base, local, remote };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function captureFailedApply(remote, plan) {
  const candidateRemote = cloneJson(remote);
  const remoteHashBefore = sha256Evidence(candidateRemote);
  let beforeMutationCalls = 0;
  let caughtError = null;

  try {
    applyPlan(candidateRemote, plan, {
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  } catch (error) {
    caughtError = error;
  }

  assert.ok(caughtError instanceof PushPlanError, 'apply should fail with PushPlanError');

  const remoteHashAfter = sha256Evidence(candidateRemote);

  return {
    code: caughtError.code,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteUnchanged: remoteHashAfter === remoteHashBefore,
    remoteHashBefore,
    remoteHashAfter,
    detailsHash: sha256Evidence(caughtError.details || {}),
    issueCodes: Array.isArray(caughtError.details?.issues)
      ? caughtError.details.issues.map((issue) => issue.code).sort()
      : [],
    refusedPlanStatus: caughtError.details?.status || null,
  };
}

function commentUserBlocker(plan) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const reference = blocker?.references?.find((entry) => entry.relationshipType === 'comment-user');

  assert.ok(blocker, 'missing unsupported comment user graph blocker');
  assert.ok(reference, 'missing unsupported comment user reference evidence');

  return { blocker, reference };
}

function assertHashOnlyChangeEvidence(change, label) {
  for (const state of ['base', 'local', 'remote']) {
    assert.match(change[state].hash, sha256Pattern, `${label}.${state}.hash`);
    assert.equal(Object.hasOwn(change[state], 'value'), false, `${label}.${state} must not include value`);
  }
}

function assertHashOnlyBlockerAndReference(blocker, reference) {
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
  ]) {
    assert.match(hash, sha256Pattern);
  }

  assertHashOnlyChangeEvidence(blocker.change, 'blocker.change');
  assertHashOnlyChangeEvidence(reference.targetChange, 'reference.targetChange');
}

function buildRpp0327Evidence() {
  const fixture = commentUserFixture();
  const plan = planFor(fixture);
  const { blocker, reference } = commentUserBlocker(plan);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, commentResourceKey), null);
  assert.equal(decisionFor(plan, userResourceKey), null);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping/);
  assert.equal(reference.relationshipKey, 'wp_comments.user_id');
  assert.equal(reference.sourceResourceKey, commentResourceKey);
  assert.equal(reference.targetResourceKey, userResourceKey);
  assert.equal(reference.targetTable, 'wp_users');
  assert.equal(reference.targetId, 'ID:327');
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentResourceKey} references an unsupported wp_comments.user_id target that is not a valid wp_users row.`,
  });
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assertHashOnlyBlockerAndReference(blocker, reference);

  const evidence = {
    rpp: 'RPP-0327',
    evidenceSource: 'comment-user-reference-v2',
    status: 'support_only',
    verdict: 'COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY',
    evidenceScope: 'local-planner-and-apply-model',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    plan: {
      id: plan.id,
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      decisionCount: plan.decisions.length,
      blockerCount: plan.blockers.length,
      hash: sha256Evidence({
        id: plan.id,
        status: plan.status,
        summary: plan.summary,
        blocker,
      }),
    },
    unsupportedTarget: {
      sourceResourceKey: blocker.resourceKey,
      relationshipType: reference.relationshipType,
      relationshipKey: reference.relationshipKey,
      targetResourceKey: reference.targetResourceKey,
      targetTable: reference.targetTable,
      targetId: reference.targetId,
      targetSupport: reference.targetSupport,
      sourceChange: {
        localChange: blocker.change.localChange,
        remoteChange: blocker.change.remoteChange,
        baseState: blocker.change.base.state,
        localState: blocker.change.local.state,
        remoteState: blocker.change.remote.state,
      },
      targetChange: {
        localChange: reference.targetChange.localChange,
        remoteChange: reference.targetChange.remoteChange,
        baseState: reference.targetChange.base.state,
        localState: reference.targetChange.local.state,
        remoteState: reference.targetChange.remote.state,
      },
      hashes: {
        sourceBaseHash: blocker.baseHash,
        sourceLocalHash: blocker.localHash,
        sourceRemoteHash: blocker.remoteHash,
        targetBaseHash: reference.targetBaseHash,
        targetLocalHash: reference.targetLocalHash,
        targetRemoteHash: reference.targetRemoteHash,
        blockerHash: sha256Evidence(blocker),
        referenceHash: sha256Evidence(reference),
      },
    },
    failClosed: {
      noMutationsPlanned: plan.mutations.length === 0,
      noPreconditionsIssued: plan.preconditions.length === 0,
      blockedApply: captureFailedApply(fixture.remote, plan),
      forgedReadyApply: captureFailedApply(fixture.remote, {
        ...plan,
        status: 'ready',
      }),
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
    },
  };

  return {
    plan,
    evidence: {
      ...evidence,
      proofHash: sha256Evidence(evidence),
    },
  };
}

function assertHashOnlyEvidence(evidence) {
  const serialized = JSON.stringify(evidence);

  for (const privateFixture of privateFixtures) {
    assert.equal(serialized.includes(privateFixture), false, `RPP-0327 evidence leaked ${privateFixture}`);
  }
  for (const rawField of ['comment_content', 'user_login', 'user_email', 'display_name']) {
    assert.equal(serialized.includes(rawField), false, `RPP-0327 evidence exposed raw field ${rawField}`);
  }

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0327 comment user v2 evidence' }));
}

test('RPP-0327 proves unsupported comment user target fails closed with hash-only evidence', () => {
  const { plan, evidence } = buildRpp0327Evidence();

  assert.equal(evidence.rpp, 'RPP-0327');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.verdict, 'COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY');
  assert.equal(evidence.plan.status, 'blocked');
  assert.equal(evidence.plan.mutationCount, 0);
  assert.equal(evidence.plan.preconditionCount, 0);
  assert.equal(evidence.plan.decisionCount, 0);
  assert.equal(evidence.plan.blockerCount, 1);
  assert.match(evidence.plan.hash, sha256EvidencePattern);
  assert.equal(plan.blockers.length, 1);

  assert.deepEqual(evidence.unsupportedTarget.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentResourceKey} references an unsupported wp_comments.user_id target that is not a valid wp_users row.`,
  });
  assert.equal(evidence.unsupportedTarget.sourceResourceKey, commentResourceKey);
  assert.equal(evidence.unsupportedTarget.relationshipType, 'comment-user');
  assert.equal(evidence.unsupportedTarget.relationshipKey, 'wp_comments.user_id');
  assert.equal(evidence.unsupportedTarget.targetResourceKey, userResourceKey);
  assert.deepEqual(evidence.unsupportedTarget.sourceChange, {
    localChange: 'create',
    remoteChange: 'unchanged',
    baseState: 'absent',
    localState: 'present',
    remoteState: 'absent',
  });
  assert.deepEqual(evidence.unsupportedTarget.targetChange, {
    localChange: 'unchanged',
    remoteChange: 'unchanged',
    baseState: 'present',
    localState: 'present',
    remoteState: 'present',
  });
  for (const hash of Object.values(evidence.unsupportedTarget.hashes)) {
    assert.match(hash, hash.startsWith('sha256:') ? sha256EvidencePattern : sha256Pattern);
  }

  assert.deepEqual(evidence.failClosed.blockedApply, {
    code: 'PLAN_NOT_READY',
    beforeMutationCalls: 0,
    preMutationRefusal: true,
    remoteUnchanged: true,
    remoteHashBefore: evidence.failClosed.blockedApply.remoteHashBefore,
    remoteHashAfter: evidence.failClosed.blockedApply.remoteHashBefore,
    detailsHash: evidence.failClosed.blockedApply.detailsHash,
    issueCodes: [],
    refusedPlanStatus: 'blocked',
  });
  assert.deepEqual(evidence.failClosed.forgedReadyApply.issueCodes, ['READY_PLAN_HAS_BLOCKERS']);
  assert.equal(evidence.failClosed.forgedReadyApply.code, 'PLAN_INVARIANT_VIOLATION');
  assert.equal(evidence.failClosed.forgedReadyApply.beforeMutationCalls, 0);
  assert.equal(evidence.failClosed.forgedReadyApply.preMutationRefusal, true);
  assert.equal(evidence.failClosed.forgedReadyApply.remoteUnchanged, true);
  assert.equal(
    evidence.failClosed.forgedReadyApply.remoteHashAfter,
    evidence.failClosed.forgedReadyApply.remoteHashBefore,
  );
  assert.match(evidence.failClosed.blockedApply.remoteHashBefore, sha256EvidencePattern);
  assert.match(evidence.failClosed.blockedApply.detailsHash, sha256EvidencePattern);
  assert.match(evidence.failClosed.forgedReadyApply.remoteHashBefore, sha256EvidencePattern);
  assert.match(evidence.failClosed.forgedReadyApply.detailsHash, sha256EvidencePattern);
  assert.match(evidence.proofHash, sha256EvidencePattern);
  assertHashOnlyEvidence(evidence);
});

test('RPP-0327 comment user v2 proof is deterministic and hash-only', () => {
  const first = buildRpp0327Evidence().evidence;
  const second = buildRpp0327Evidence().evidence;

  assert.deepEqual(first, second);
  assertHashOnlyEvidence(first);
});
