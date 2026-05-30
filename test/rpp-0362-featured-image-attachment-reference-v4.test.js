import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const thumbnailMetaResourceKey = rowResourceKey('wp_postmeta', 'meta_id:36201');
const staleAttachmentResourceKey = rowResourceKey('wp_posts', 'ID:77');
const unsupportedTargetResourceKey = rowResourceKey('wp_posts', 'ID:88');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
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
          post_title: 'RPP-0362 stable base post',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
        },
      },
      wp_postmeta: {},
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey = thumbnailMetaResourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertSha256Hex(value, label) {
  assert.match(value, sha256HexPattern, label);
}

function assertChangeHashOnly(change, label) {
  assert.ok(change, `${label} missing change evidence`);
  assertSha256Hex(change.base.hash, `${label} base hash`);
  assertSha256Hex(change.local.hash, `${label} local hash`);
  assertSha256Hex(change.remote.hash, `${label} remote hash`);
  assert.equal(Object.hasOwn(change.base, 'value'), false, `${label} base leaked raw value`);
  assert.equal(Object.hasOwn(change.local, 'value'), false, `${label} local leaked raw value`);
  assert.equal(Object.hasOwn(change.remote, 'value'), false, `${label} remote leaked raw value`);
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked ${rawValue}`);
  }
}

function assertFeaturedImageBlockerShape({
  plan,
  base,
  local,
  remote,
  targetResourceKey,
  targetSupportReason = null,
  targetRemoteChange,
  rawValues,
}) {
  const blocker = blockerFor(plan);
  const reference = blocker?.references.find((entry) =>
    entry.relationshipType === 'featured-image-attachment');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(mutationFor(plan, thumbnailMetaResourceKey), undefined);
  assert.ok(blocker, 'missing thumbnail postmeta graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resourceKey, thumbnailMetaResourceKey);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assertSha256Hex(blocker.baseHash, 'blocker base hash');
  assertSha256Hex(blocker.localHash, 'blocker local hash');
  assertSha256Hex(blocker.remoteHash, 'blocker remote hash');
  assertChangeHashOnly(blocker.change, 'source postmeta blocker change');
  assert.ok(reference, 'missing featured-image-attachment reference evidence');
  assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
  assert.equal(reference.sourceResourceKey, thumbnailMetaResourceKey);
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetBaseHash, resourceHash(base, reference.targetResource));
  assert.equal(reference.targetLocalHash, resourceHash(local, reference.targetResource));
  assert.equal(reference.targetRemoteHash, resourceHash(remote, reference.targetResource));
  assertSha256Hex(reference.targetBaseHash, 'reference target base hash');
  assertSha256Hex(reference.targetLocalHash, 'reference target local hash');
  assertSha256Hex(reference.targetRemoteHash, 'reference target remote hash');
  assert.equal(reference.targetChange.remoteChange, targetRemoteChange);
  assertChangeHashOnly(reference.targetChange, 'featured image target reference change');

  if (targetSupportReason) {
    assert.equal(reference.targetSupport.supported, false);
    assert.equal(reference.targetSupport.className, 'stale-wordpress-graph-identity');
    assert.match(reference.targetSupport.reason, targetSupportReason);
  } else {
    assert.equal(Object.hasOwn(reference, 'targetSupport'), false);
  }

  const applyError = captureError(() => applyPlan(remote, plan, { mutateRemote: true }));
  assert.ok(applyError instanceof PushPlanError);
  assert.equal(applyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(applyError.details, { status: 'blocked' });

  const proof = {
    rpp: 'RPP-0362',
    proofScope: 'local-focused-regression',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      sourceChange: {
        localChange: blocker.change.localChange,
        remoteChange: blocker.change.remoteChange,
        baseHash: blocker.change.base.hash,
        localHash: blocker.change.local.hash,
        remoteHash: blocker.change.remote.hash,
      },
    },
    reference: {
      relationshipType: reference.relationshipType,
      targetResourceKey: reference.targetResourceKey,
      targetBaseHash: reference.targetBaseHash,
      targetLocalHash: reference.targetLocalHash,
      targetRemoteHash: reference.targetRemoteHash,
      targetLocalChange: reference.targetChange.localChange,
      targetRemoteChange: reference.targetChange.remoteChange,
      targetSupport: reference.targetSupport || { supported: true },
    },
    applyRefusal: {
      code: applyError.code,
      detailsHash: `sha256:${digest(applyError.details)}`,
    },
  };
  proof.proofHash = `sha256:${digest(proof)}`;

  assertNoRawValues(plan, rawValues, 'blocked plan evidence');
  assertNoRawValues(blocker, rawValues, 'blocker evidence');
  assertNoRawValues(reference, rawValues, 'reference evidence');
  assertNoRawValues(applyError.details, rawValues, 'apply refusal details');
  assertNoRawValues(proof, rawValues, 'hash-only proof envelope');
  assert.equal(JSON.stringify(plan).includes('private_payload'), false);
  assert.equal(JSON.stringify(proof).includes('private_payload'), false);

  return { blocker, reference, proof };
}

test('RPP-0362 blocks stale featured image attachment targets with hash-only blocker/reference evidence', () => {
  const rawValues = [
    'rpp-0362-base-private-attachment-title',
    'rpp-0362-base-private-attachment-body',
    'rpp-0362-remote-stale-attachment-title',
    'rpp-0362-remote-stale-attachment-body',
    'rpp-0362-stale-local-postmeta-private-payload',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:77'] = {
    ID: 77,
    post_title: rawValues[0],
    post_content: rawValues[1],
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: 1,
  };
  const local = cloneJson(base);
  local.db.wp_postmeta['meta_id:36201'] = {
    meta_id: 36201,
    post_id: 1,
    meta_key: '_thumbnail_id',
    meta_value: '77',
    private_payload: rawValues[4],
  };
  const remote = cloneJson(base);
  remote.db.wp_posts['ID:77'].post_title = rawValues[2];
  remote.db.wp_posts['ID:77'].post_content = rawValues[3];
  const remoteBeforeHash = digest(remote);

  const plan = planFor(base, local, remote);
  const { reference } = assertFeaturedImageBlockerShape({
    plan,
    base,
    local,
    remote,
    targetResourceKey: staleAttachmentResourceKey,
    targetRemoteChange: 'update',
    rawValues,
  });

  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(decisionFor(plan, staleAttachmentResourceKey).decision, 'keep-remote');
  assert.equal(digest(remote), remoteBeforeHash, 'blocked apply must preserve stale remote attachment snapshot');
});

test('RPP-0362 blocks unsupported non-attachment _thumbnail_id targets without raw postmeta payload leakage', () => {
  const rawValues = [
    'rpp-0362-base-private-page-target-title',
    'rpp-0362-base-private-page-target-body',
    'rpp-0362-unsupported-local-postmeta-private-payload',
  ];
  const base = baseSite();
  base.db.wp_posts['ID:88'] = {
    ID: 88,
    post_title: rawValues[0],
    post_content: rawValues[1],
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
  };
  const local = cloneJson(base);
  local.db.wp_postmeta['meta_id:36201'] = {
    meta_id: 36201,
    post_id: 1,
    meta_key: '_thumbnail_id',
    meta_value: '88',
    private_payload: rawValues[2],
  };
  const remote = cloneJson(base);
  const remoteBeforeHash = digest(remote);

  const plan = planFor(base, local, remote);
  const { reference } = assertFeaturedImageBlockerShape({
    plan,
    base,
    local,
    remote,
    targetResourceKey: unsupportedTargetResourceKey,
    targetSupportReason: /not a supported attachment row/,
    targetRemoteChange: 'unchanged',
    rawValues,
  });

  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(decisionFor(plan, unsupportedTargetResourceKey), undefined);
  assert.equal(digest(remote), remoteBeforeHash, 'blocked apply must preserve unsupported target snapshot');
});
