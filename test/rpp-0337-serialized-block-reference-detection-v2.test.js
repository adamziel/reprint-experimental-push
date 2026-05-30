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
  for (const slot of ['base', 'local', 'remote']) {
    assertHash(entry.change[slot].hash, `${label}.change.${slot}.hash`);
    assert.equal(
      Object.hasOwn(entry.change[slot], 'value'),
      false,
      `${label}.change.${slot} must be hash-only`,
    );
  }
  assertNoRawValues(JSON.stringify(entry), rawValues, label);
}

function assertHashOnlyTargetEvidence(reference, rawValues, label) {
  assertHash(reference.targetBaseHash, `${label}.targetBaseHash`);
  assertHash(reference.targetLocalHash, `${label}.targetLocalHash`);
  assertHash(reference.targetRemoteHash, `${label}.targetRemoteHash`);
  for (const slot of ['base', 'local', 'remote']) {
    assertHash(reference.targetChange[slot].hash, `${label}.targetChange.${slot}.hash`);
    assert.equal(
      Object.hasOwn(reference.targetChange[slot], 'value'),
      false,
      `${label}.targetChange.${slot} must be hash-only`,
    );
  }
  assertNoRawValues(JSON.stringify(reference), rawValues, label);
}

test('RPP-0337 serialized media-text excerpt unsupported target fails closed with hash-only evidence', () => {
  const sourceResourceKey = rowResourceKey('wp_posts', 'ID:337');
  const pageTargetResourceKey = rowResourceKey('wp_posts', 'ID:8337');
  const rawValues = [
    'rpp-0337-local-media-text-title',
    'rpp-0337-local-media-text-caption',
    'https://private.example/rpp-0337-media.jpg',
    'rpp-0337-base-page-target-title',
    'rpp-0337-base-page-target-body',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:8337'] = {
    ID: 8337,
    post_title: rawValues[3],
    post_name: 'rpp0337-base-page-target',
    post_content: rawValues[4],
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:337'] = {
    ID: 337,
    post_title: rawValues[0],
    post_name: 'rpp0337-local-media-text-host',
    post_content: 'RPP-0337 host body keeps the serialized block in the excerpt.',
    post_excerpt: `<!-- wp:media-text {"mediaId":8337,"mediaType":"image","mediaUrl":"${rawValues[2]}"} --><div class="wp-block-media-text"><div class="wp-block-media-text__content"><p>${rawValues[1]}</p></div></div><!-- /wp:media-text -->`,
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };

  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const blocker = plan.blockers.find((entry) => entry.resourceKey === sourceResourceKey);
  const reference = blocker?.references.find((entry) =>
    entry.relationshipType === 'serialized-block-attachment'
    && entry.targetResourceKey === pageTargetResourceKey);
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.blockers, 1);
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === sourceResourceKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === sourceResourceKey), false);

  assert.ok(blocker, 'missing unsupported serialized block graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(blocker, rawValues, 'unsupported serialized media-text blocker');

  assert.ok(reference, 'missing serialized media-text target evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_excerpt');
  assert.equal(reference.serializedBlockName, 'core/media-text');
  assert.equal(reference.serializedBlockAttributePath, 'mediaId');
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${sourceResourceKey} references a serialized block attachment target that is not a supported attachment row.`,
  });
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  assertHashOnlyTargetEvidence(reference, rawValues, 'unsupported serialized media-text target reference');
  assertNoRawValues(JSON.stringify(plan.blockers), rawValues, 'blocked plan graph evidence');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'unsupported serialized block target must refuse before mutation');
});
