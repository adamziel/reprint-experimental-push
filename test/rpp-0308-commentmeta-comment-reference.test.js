import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const hashPattern = /^[0-9a-f]{64}$/;

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
          post_title: 'Base post',
          post_status: 'publish',
        },
      },
      wp_comments: {},
      wp_commentmeta: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function generatedPlanFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

test('RPP-0308 fails closed when a commentmeta comment target is not a valid comment row', () => {
  const commentmetaResourceKey = rowResourceKey('wp_commentmeta', 'meta_id:308');
  const targetCommentResourceKey = rowResourceKey('wp_comments', 'comment_ID:808');
  const base = baseSite();
  base.db.wp_comments['comment_ID:808'] = {
    comment_ID: 909,
    comment_post_ID: 1,
    comment_parent: 0,
    comment_content: 'base-private-rpp0308-mismatched-comment-target',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_commentmeta['meta_id:308'] = {
    meta_id: 308,
    comment_id: 808,
    meta_key: '_rpp0308_local_comment_marker',
    meta_value: 'local-private-rpp0308-commentmeta-value',
  };

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentmetaResourceKey);
  const commentmetaReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'commentmeta-comment');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, commentmetaResourceKey), undefined);
  assert.ok(blocker, 'missing commentmeta graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(commentmetaReference, 'missing commentmeta comment reference evidence');
  assert.equal(commentmetaReference.relationshipKey, 'wp_commentmeta.comment_id');
  assert.equal(commentmetaReference.targetResourceKey, targetCommentResourceKey);
  assert.equal(commentmetaReference.targetChange.localChange, 'unchanged');
  assert.equal(commentmetaReference.targetChange.remoteChange, 'unchanged');
  assert.deepEqual(commentmetaReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${commentmetaResourceKey} references an unsupported wp_commentmeta.comment_id target that is not a valid wp_comments row.`,
  });
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
    commentmetaReference.targetBaseHash,
    commentmetaReference.targetLocalHash,
    commentmetaReference.targetRemoteHash,
    commentmetaReference.targetChange.base.hash,
    commentmetaReference.targetChange.local.hash,
    commentmetaReference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  for (const privateValue of [
    'local-private-rpp0308-commentmeta-value',
    'base-private-rpp0308-mismatched-comment-target',
  ]) {
    assert.equal(blockerJson.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('RPP-0308 generated harness emits commentmeta comment ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.commentmetaCommentGraph;

  assert.ok(coverage, 'missing commentmeta comment graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['commentmeta-comment-graph']);
  assert.equal(coverage.statuses.ready, 10, 'expected one ready commentmeta comment case per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'expected one stale commentmeta comment case per tier');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('commentmeta-comment-graph'));
  const readyCases = targetCases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleCases = targetCases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.equal(targetCases.length, coverage.total);
  assert.equal(readyCases.length, 10, 'missing one ready commentmeta comment case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale commentmeta comment case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    const shape = assertGeneratedCommentmetaCommentShape(readyCase, { staleTarget: false });
    const plan = generatedPlanFor(readyCase);
    const result = validateGeneratedCase(readyCase);
    const commentMutation = mutationFor(plan, shape.commentResourceKey);
    const commentmetaMutation = mutationFor(plan, shape.commentmetaResourceKey);
    const plannedCommentmeta = deserializeResourceValue(commentmetaMutation.value);

    assert.equal(plan.status, 'ready');
    assert.equal(result.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.ok(commentMutation, `${readyCase.id} should create the comment target`);
    assert.ok(commentmetaMutation, `${readyCase.id} should create the commentmeta row`);
    assert.equal(plannedCommentmeta.comment_id, shape.commentId);
    assert.equal(commentmetaMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);

    const applied = applyPlan(cloneJson(readyCase.remote), plan);
    assert.deepEqual(applied.site.db.wp_comments[shape.commentRowId], readyCase.local.db.wp_comments[shape.commentRowId]);
    assert.deepEqual(
      applied.site.db.wp_commentmeta[shape.commentmetaRowId],
      readyCase.local.db.wp_commentmeta[shape.commentmetaRowId],
    );
    assertRpp0308RedactedEvidence(readyCase, plan, shape);
  }

  for (const staleCase of staleCases) {
    const shape = assertGeneratedCommentmetaCommentShape(staleCase, { staleTarget: true });
    const plan = generatedPlanFor(staleCase);
    const result = validateGeneratedCase(staleCase);
    const staleBlocker = plan.blockers.find((blocker) =>
      blocker.resourceKey === shape.commentmetaResourceKey);
    const staleReference = staleBlocker?.references.find((reference) =>
      reference.relationshipType === 'commentmeta-comment');
    const remoteBefore = cloneJson(staleCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));
    const blockerJson = JSON.stringify(staleBlocker);

    assert.notEqual(plan.status, 'ready');
    assert.notEqual(result.status, 'ready');
    assert.equal(result.applied, false);
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), beforeHash, `${staleCase.id} refusal must happen before mutation`);
    assert.equal(mutationFor(plan, shape.commentmetaResourceKey), undefined);
    assert.ok(staleBlocker, `${staleCase.id} should block the stale commentmeta row`);
    assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
    assert.ok(staleReference, `${staleCase.id} should include commentmeta comment reference evidence`);
    assert.equal(staleReference.relationshipKey, 'wp_commentmeta.comment_id');
    assert.equal(staleReference.targetResourceKey, shape.commentResourceKey);
    assert.equal(staleReference.targetChange.remoteChange, 'update');
    assert.match(staleReference.targetRemoteHash, hashPattern);
    assert.match(staleReference.targetBaseHash, hashPattern);
    assert.match(staleReference.targetLocalHash, hashPattern);
    assert.equal(blockerJson.includes('generated commentmeta graph '), false);
    assert.equal(blockerJson.includes('Remote stale comment graph target'), false);
    assertRpp0308RedactedEvidence(staleCase, plan, shape);
  }
});

function assertGeneratedCommentmetaCommentShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('commentmeta-comment-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));

  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) =>
      !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one wp_commentmeta row`);

  const [commentmetaRowId, commentmetaRow] = commentmetaRows[0];
  const commentId = Number(commentmetaRow.comment_id);
  const commentRowId = `comment_ID:${commentId}`;
  const localComment = testCase.local.db.wp_comments[commentRowId];
  const baseComment = testCase.base.db.wp_comments[commentRowId];
  const remoteComment = testCase.remote.db.wp_comments[commentRowId];

  assert.ok(Number.isSafeInteger(commentId), `${testCase.id} comment_id should be numeric`);
  assert.ok(localComment, `${testCase.id} should have a local wp_comments target`);
  assert.equal(localComment.comment_ID, commentId);
  assert.equal(localComment.comment_content, `Generated comment graph target ${commentId}`);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.deepEqual(localComment, baseComment, `${testCase.id} local stale target should match base`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} stale target should drift remotely`);
    assert.equal(remoteComment.comment_content, `Remote stale comment graph target ${commentId}`);
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-comments-remote-drift'));
  } else {
    assert.equal(baseComment, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteComment, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-comments-create'));
  }

  return {
    commentId,
    commentRowId,
    commentmetaRowId,
    localComment,
    baseComment,
    remoteComment,
    commentmetaRow,
    commentResourceKey: rowResourceKey('wp_comments', commentRowId),
    commentmetaResourceKey: rowResourceKey('wp_commentmeta', commentmetaRowId),
  };
}

function assertRpp0308RedactedEvidence(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    summary: plan.summary,
    blockers: plan.blockers,
    mutations: plan.mutations,
    rawCommentmetaProbe: {
      value: {
        localComment: shape.localComment,
        baseComment: shape.baseComment,
        remoteComment: shape.remoteComment,
        commentmeta: shape.commentmetaRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw commentmeta evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} should keep hash-only redacted values`);
  assert.equal(serialized.includes('generated commentmeta graph '), false, `${testCase.id} leaked raw commentmeta value`);
  assert.equal(serialized.includes('Generated comment graph target'), false, `${testCase.id} leaked raw comment target`);
  assert.equal(serialized.includes('Remote stale comment graph target'), false, `${testCase.id} leaked stale comment target`);
}
