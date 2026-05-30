import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const fileResourceKey = 'file:index.php';
const rowResourceKey = 'row:["wp_posts","ID:1"]';
const sentinelPath = 'wp-content/uploads/rpp-0272-sentinel.txt';

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0272-base-index";',
      [sentinelPath]: 'rpp0272-sentinel-remote-private',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'RPP-0272 base title', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0272-local-index-private";',
    'rpp0272-local-title-private',
    '<?php echo "rpp0272-stale-index-private";',
    'rpp0272-stale-title-private',
    'rpp0272-sentinel-remote-private',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];

  return { base, local, remote, privateValues };
}

function planFor(input) {
  return createPushPlan({
    base: input.base,
    local: input.local,
    remote: input.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '7'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function assertNoTargetOrMutationJournalEvents(events, label) {
  assert.equal(
    events.filter((event) => event.type === 'target-planned' || event.type.includes('mutation')).length,
    0,
    `${label} wrote target or mutation journal evidence before refusal`,
  );
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
  }
}

test('RPP-0272 planner binds remoteBeforeHash to the focused live mutation target', () => {
  const input = fixture();
  const ready = planFor(input);

  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.summary, {
    mutations: 2,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), [fileResourceKey, rowResourceKey]);
  assert.equal(ready.preconditions.length, ready.mutations.length);

  const proof = ready.mutations.map((mutation) => {
    const precondition = preconditionFor(ready, mutation);
    const observedRemoteHash = resourceHash(input.remote, mutation.resource);
    const observedLocalHash = resourceHash(input.local, mutation.resource);

    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.match(mutation.remoteBeforeHash, SHA256_HEX_PATTERN);
    assert.equal(mutation.remoteBeforeHash, observedRemoteHash, `${mutation.resourceKey} remote hash`);
    assert.equal(precondition.expectedHash, observedRemoteHash, `${mutation.resourceKey} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${mutation.resourceKey} precondition scope`);
    assert.notEqual(
      mutation.remoteBeforeHash,
      observedLocalHash,
      `${mutation.resourceKey} remoteBeforeHash must not be derived from local payloads`,
    );

    return {
      resourceKey: mutation.resourceKey,
      remoteBeforeHash: mutation.remoteBeforeHash,
      observedRemoteHash,
      observedLocalHash,
      preconditionHash: precondition.expectedHash,
    };
  });

  assertHashOnlyEvidenceRedacted({ proof, proofHash: digest(proof) }, input.privateValues);
});

test('RPP-0272 executor rejects forged remoteBeforeHash aliases before mutation', () => {
  const input = fixture();
  const ready = planFor(input);
  const forged = cloneJson(ready);
  const forgedMutation = mutationFor(forged, fileResourceKey);
  const forgedPrecondition = preconditionFor(forged, forgedMutation);
  const applyRemote = cloneJson(input.remote);
  const journalEvents = [];

  applyRemote.files['index.php'] = input.privateValues[2];
  const sentinelResourceWithForgedKey = {
    type: 'file',
    path: sentinelPath,
    key: fileResourceKey,
  };
  const sentinelHash = resourceHash(applyRemote, sentinelResourceWithForgedKey);
  forgedMutation.remoteBeforeHash = sentinelHash;
  forgedPrecondition.expectedHash = sentinelHash;
  forgedPrecondition.resource = sentinelResourceWithForgedKey;

  const beforeRemote = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const error = captureError(() => applyPlan(applyRemote, forged, {
    durableJournal: durableJournal(journalEvents),
  }));
  const evidence = {
    code: error.code,
    details: error.details,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    error.details.issues.some((issue) =>
      issue.code === 'PRECONDITION_RESOURCE_OBJECT_MISMATCH'
      && issue.expectedResourceKey === fileResourceKey
      && issue.actualResourceKey === `file:${sentinelPath}`,
    ),
    'forged precondition resource object should be rejected even when its key is forged to the mutation target',
  );
  assert.equal(JSON.stringify(applyRemote), beforeRemote, 'forged plan mutated the remote before refusal');
  assert.equal(digest(applyRemote), beforeRemoteHash, 'forged plan changed the remote hash before refusal');
  assertNoTargetOrMutationJournalEvents(journalEvents, 'forged remoteBeforeHash alias');
  assertHashOnlyEvidenceRedacted(evidence, input.privateValues);
});

test('RPP-0272 executor rejects stale later mutation attempts before earlier mutations are staged', () => {
  const input = fixture();
  const ready = planFor(input);
  const staleMutation = mutationFor(ready, rowResourceKey);
  const applyRemote = cloneJson(input.remote);
  const journalEvents = [];

  applyRemote.db.wp_posts['ID:1'].post_title = input.privateValues[3];
  const staleActualHash = resourceHash(applyRemote, staleMutation.resource);
  assert.notEqual(staleActualHash, staleMutation.remoteBeforeHash, 'stale fixture must drift the row hash');

  const beforeRemote = JSON.stringify(applyRemote);
  const beforeRemoteHash = digest(applyRemote);
  const error = captureError(() => applyPlan(applyRemote, ready, {
    durableJournal: durableJournal(journalEvents),
  }));
  const evidence = {
    code: error.code,
    resourceKey: error.details.resourceKey,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    beforeRemoteHash,
    afterRemoteHash: digest(applyRemote),
    journalEventTypes: journalEvents.map((event) => event.type),
  };

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, rowResourceKey);
  assert.equal(error.details.expectedHash, staleMutation.remoteBeforeHash);
  assert.equal(error.details.actualHash, staleActualHash);
  assert.equal(JSON.stringify(applyRemote), beforeRemote, 'stale row plan mutated the remote before refusal');
  assert.equal(digest(applyRemote), beforeRemoteHash, 'stale row plan changed the remote hash before refusal');
  assert.equal(applyRemote.files['index.php'], input.remote.files['index.php'], 'earlier file mutation was not staged');
  assertNoTargetOrMutationJournalEvents(journalEvents, 'stale later mutation');
  assertHashOnlyEvidenceRedacted(evidence, input.privateValues);
});
