import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} should be a SHA-256 hex digest`);
}

function assertNoRawValues(serializedEvidence, rawValues, label) {
  for (const rawValue of rawValues) {
    assert.equal(
      serializedEvidence.includes(rawValue),
      false,
      `${label} leaked raw value: ${rawValue}`,
    );
  }
}

function assertHashOnlyChangeEvidence(entry, rawValues, label) {
  assertHash(entry.baseHash, `${label}.baseHash`);
  assertHash(entry.localHash, `${label}.localHash`);
  assertHash(entry.remoteHash, `${label}.remoteHash`);
  assertHash(entry.change.base.hash, `${label}.change.base.hash`);
  assertHash(entry.change.local.hash, `${label}.change.local.hash`);
  assertHash(entry.change.remote.hash, `${label}.change.remote.hash`);
  assert.equal(Object.hasOwn(entry.change.local, 'value'), false);
  assert.equal(Object.hasOwn(entry.change.remote, 'value'), false);
  assertNoRawValues(JSON.stringify(entry), rawValues, label);
}

function assertHashOnlyTargetEvidence(reference, rawValues, label) {
  assertHash(reference.targetBaseHash, `${label}.targetBaseHash`);
  assertHash(reference.targetLocalHash, `${label}.targetLocalHash`);
  assertHash(reference.targetRemoteHash, `${label}.targetRemoteHash`);
  assertHash(reference.targetChange.base.hash, `${label}.targetChange.base.hash`);
  assertHash(reference.targetChange.local.hash, `${label}.targetChange.local.hash`);
  assertHash(reference.targetChange.remote.hash, `${label}.targetChange.remote.hash`);
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
  assertNoRawValues(JSON.stringify(reference), rawValues, label);
}

test('RPP-0377 serialized gallery block unsupported target fails closed with hash-only evidence', () => {
  const postResourceKey = rowResourceKey('wp_posts', 'ID:377');
  const pageTargetResourceKey = rowResourceKey('wp_posts', 'ID:8377');
  const rawValues = [
    'local-private-rpp0377-gallery-post-title',
    'local-private-rpp0377-gallery-caption',
    'base-private-rpp0377-page-target-title',
    'base-private-rpp0377-page-target-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:8377'] = {
    ID: 8377,
    post_title: 'base-private-rpp0377-page-target-title',
    post_name: 'base-private-rpp0377-page-target',
    post_content: 'base-private-rpp0377-page-target-body',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:377'] = {
    ID: 377,
    post_title: 'local-private-rpp0377-gallery-post-title',
    post_name: 'local-private-rpp0377-gallery-post',
    post_content: '<!-- wp:gallery {"ids":[8377],"caption":"local-private-rpp0377-gallery-caption"} /-->',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };

  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const blocker = plan.blockers.find((entry) => entry.resourceKey === postResourceKey);
  const reference = blocker?.references.find((entry) =>
    entry.relationshipType === 'serialized-block-attachment'
    && entry.targetResourceKey === pageTargetResourceKey);
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.blockers, 1);
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === postResourceKey), false);
  assert.ok(blocker, 'missing unsupported serialized block graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(blocker, rawValues, 'unsupported serialized gallery blocker');

  assert.ok(reference, 'missing serialized gallery attachment target evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_content');
  assert.equal(reference.serializedBlockName, 'core/gallery');
  assert.equal(reference.serializedBlockAttributePath, 'ids.0');
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${postResourceKey} references a serialized block attachment target that is not a supported attachment row.`,
  });
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assertHashOnlyTargetEvidence(reference, rawValues, 'unsupported serialized gallery target reference');
  assertNoRawValues(JSON.stringify(plan.blockers), rawValues, 'blocked plan graph evidence');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'unsupported serialized block target must refuse before mutation');
});
