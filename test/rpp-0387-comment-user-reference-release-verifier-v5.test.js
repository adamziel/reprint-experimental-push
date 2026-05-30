import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T03:38:07.000Z');
const commentResourceKey = 'row:["wp_comments","comment_ID:387"]';
const userResourceKey = 'row:["wp_users","ID:77"]';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const privateFixtures = Object.freeze([
  'local-private-rpp0387-comment-user-body',
  'base-private-rpp0387-unsupported-user',
  'base-private-rpp0387-unsupported-user@example.test',
  'Base Private RPP-0387 Unsupported User',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0387 base post',
          post_status: 'publish',
        },
      },
      wp_users: {
        'ID:77': {
          // The row key says ID:77, but the row itself does not prove that
          // identity. A wp_comments.user_id reference to 77 must fail closed.
          ID: 78,
          user_login: 'base-private-rpp0387-unsupported-user',
          user_email: 'base-private-rpp0387-unsupported-user@example.test',
          display_name: 'Base Private RPP-0387 Unsupported User',
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

  local.db.wp_comments['comment_ID:387'] = {
    comment_ID: 387,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 77,
    comment_content: 'local-private-rpp0387-comment-user-body',
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

function failedApplyEvidence(remote, plan) {
  const candidateRemote = cloneJson(remote);
  const remoteHashBefore = sha256Evidence(candidateRemote);

  try {
    applyPlan(candidateRemote, plan);
  } catch (error) {
    const remoteHashAfter = sha256Evidence(candidateRemote);

    return {
      code: error.code,
      rejectedBeforeMutation: true,
      remoteUnchanged: remoteHashAfter === remoteHashBefore,
      remoteHashBefore,
      remoteHashAfter,
      detailsHash: sha256Evidence(error.details || {}),
      issueCodes: Array.isArray(error.details?.issues)
        ? error.details.issues.map((issue) => issue.code).sort()
        : [],
      refusedPlanStatus: error.details?.status || null,
    };
  }

  assert.fail('release verifier apply path unexpectedly accepted the unsupported comment user plan');
}

function commentUserReferenceBlocker(plan) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentResourceKey);
  const reference = blocker?.references?.find((entry) => entry.relationshipType === 'comment-user');

  assert.ok(blocker, 'missing unsupported comment user graph blocker');
  assert.ok(reference, 'missing unsupported comment user reference evidence');

  return { blocker, reference };
}

function summarizeUnsupportedCommentUserReleaseVerifierEvidence(plan, remote) {
  const { blocker, reference } = commentUserReferenceBlocker(plan);
  const planHash = sha256Evidence({
    id: plan.id,
    status: plan.status,
    summary: plan.summary,
    blocker,
  });
  const blockerHash = sha256Evidence(blocker);
  const referenceHash = sha256Evidence(reference);
  const blockedApply = failedApplyEvidence(remote, plan);
  const forgedReadyApply = failedApplyEvidence(remote, {
    ...plan,
    status: 'ready',
  });

  const proof = {
    rpp: 'RPP-0387',
    evidenceSource: 'release-verifier-comment-user-reference-v5',
    status: 'support_only',
    verdict: 'COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    releaseVerifier: {
      checkedBy: 'local release verifier regression',
      check: 'wp_comments.user_id unsupported target',
      variant: 'v5',
      phase: 'before-first-mutation',
    },
    plan: {
      id: plan.id,
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      decisionCount: plan.decisions.length,
      blockerCount: plan.blockers.length,
      hash: planHash,
    },
    unsupportedTarget: {
      resourceKey: blocker.resourceKey,
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
        blockerHash,
        referenceHash,
      },
    },
    failClosed: {
      noMutationsPlanned: plan.mutations.length === 0,
      noPreconditionsIssued: plan.preconditions.length === 0,
      blockedApply,
      forgedReadyApply,
    },
    redaction: {
      format: 'hash-only',
      sourceFields: [
        'resourceKey',
        'relationshipKey',
        'targetResourceKey',
        'targetSupport',
        'hashes',
        'refusal codes',
      ],
    },
  };

  return {
    ...proof,
    proofHash: sha256Evidence(proof),
  };
}

function assertHashOnlyProof(proof) {
  const serialized = JSON.stringify(proof);

  for (const privateFixture of privateFixtures) {
    assert.equal(serialized.includes(privateFixture), false, `release verifier proof leaked ${privateFixture}`);
  }
  for (const rawField of ['comment_content', 'user_login', 'user_email', 'display_name']) {
    assert.equal(serialized.includes(rawField), false, `release verifier proof exposed raw field ${rawField}`);
  }

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0387 comment user release verifier proof' }));
}

test('RPP-0387 release verifier carries unsupported comment user target as hash-only NO-GO evidence', () => {
  const fixture = commentUserFixture();
  const plan = planFor(fixture);
  const proof = summarizeUnsupportedCommentUserReleaseVerifierEvidence(plan, fixture.remote);

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(proof.rpp, 'RPP-0387');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.plan.status, 'blocked');
  assert.equal(proof.plan.mutationCount, 0);
  assert.equal(proof.plan.preconditionCount, 0);
  assert.equal(proof.plan.blockerCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.deepEqual(proof.unsupportedTarget.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentResourceKey} references an unsupported wp_comments.user_id target that is not a valid wp_users row.`,
  });
  assert.equal(proof.unsupportedTarget.resourceKey, commentResourceKey);
  assert.equal(proof.unsupportedTarget.relationshipType, 'comment-user');
  assert.equal(proof.unsupportedTarget.relationshipKey, 'wp_comments.user_id');
  assert.equal(proof.unsupportedTarget.targetResourceKey, userResourceKey);
  assert.deepEqual(proof.unsupportedTarget.sourceChange, {
    localChange: 'create',
    remoteChange: 'unchanged',
    baseState: 'absent',
    localState: 'present',
    remoteState: 'absent',
  });
  assert.deepEqual(proof.unsupportedTarget.targetChange, {
    localChange: 'unchanged',
    remoteChange: 'unchanged',
    baseState: 'present',
    localState: 'present',
    remoteState: 'present',
  });
  for (const hash of Object.values(proof.unsupportedTarget.hashes)) {
    assert.match(hash, hash.startsWith('sha256:') ? sha256EvidencePattern : sha256Pattern);
  }

  assert.deepEqual(proof.failClosed.blockedApply, {
    code: 'PLAN_NOT_READY',
    rejectedBeforeMutation: true,
    remoteUnchanged: true,
    remoteHashBefore: proof.failClosed.blockedApply.remoteHashBefore,
    remoteHashAfter: proof.failClosed.blockedApply.remoteHashBefore,
    detailsHash: proof.failClosed.blockedApply.detailsHash,
    issueCodes: [],
    refusedPlanStatus: 'blocked',
  });
  assert.match(proof.failClosed.blockedApply.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.failClosed.blockedApply.detailsHash, sha256EvidencePattern);
  assert.deepEqual(proof.failClosed.forgedReadyApply.issueCodes, ['READY_PLAN_HAS_BLOCKERS']);
  assert.equal(proof.failClosed.forgedReadyApply.code, 'PLAN_INVARIANT_VIOLATION');
  assert.equal(proof.failClosed.forgedReadyApply.rejectedBeforeMutation, true);
  assert.equal(proof.failClosed.forgedReadyApply.remoteUnchanged, true);
  assert.equal(proof.failClosed.forgedReadyApply.remoteHashAfter, proof.failClosed.forgedReadyApply.remoteHashBefore);
  assert.match(proof.failClosed.forgedReadyApply.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.failClosed.forgedReadyApply.detailsHash, sha256EvidencePattern);
  assert.equal(proof.redaction.format, 'hash-only');
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertHashOnlyProof(proof);
});

test('RPP-0387 unsupported comment user release verifier evidence is deterministic and hash-only', () => {
  const firstFixture = commentUserFixture();
  const secondFixture = commentUserFixture();
  const firstProof = summarizeUnsupportedCommentUserReleaseVerifierEvidence(planFor(firstFixture), firstFixture.remote);
  const secondProof = summarizeUnsupportedCommentUserReleaseVerifierEvidence(planFor(secondFixture), secondFixture.remote);

  assert.deepEqual(firstProof, secondProof);
  assertHashOnlyProof(firstProof);
});
