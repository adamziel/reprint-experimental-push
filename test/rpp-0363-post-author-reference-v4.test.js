import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const authorId = 3637;
const postId = 3638;
const authorRowId = `ID:${authorId}`;
const postRowId = `ID:${postId}`;
const authorResourceKey = rowResourceKey('wp_users', authorRowId);
const postResourceKey = rowResourceKey('wp_posts', postRowId);
const hashPattern = /^[a-f0-9]{64}$/;
const rawUserPayloads = Object.freeze([
  'base-private-rpp0363-author-login',
  'base-private-rpp0363-author@example.test',
  'Base Private RPP-0363 Author',
  'remote-private-rpp0363-author@example.test',
  'Remote Private RPP-0363 Author',
]);
const rawStalePostPayloads = Object.freeze([
  'Local Private RPP-0363 Authored Post',
  'local-private-rpp0363-authored-post',
  'local-private-rpp0363-post-content',
]);

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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
          post_title: 'Base post',
          post_name: 'base-post',
          post_content: 'Base post content',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_users: {
        [authorRowId]: stableAuthorRow(),
      },
    },
  };
}

function stableAuthorRow() {
  return {
    ID: authorId,
    user_login: 'base-private-rpp0363-author-login',
    user_email: 'base-private-rpp0363-author@example.test',
    display_name: 'Base Private RPP-0363 Author',
  };
}

function localAuthoredPost() {
  return {
    ID: postId,
    post_title: 'Local Private RPP-0363 Authored Post',
    post_name: 'local-private-rpp0363-authored-post',
    post_content: 'local-private-rpp0363-post-content',
    post_status: 'draft',
    post_type: 'post',
    post_parent: 0,
    post_author: authorId,
  };
}

function postAuthorCase({ staleAuthor = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts[postRowId] = localAuthoredPost();

  if (staleAuthor) {
    remote.db.wp_users[authorRowId] = {
      ...remote.db.wp_users[authorRowId],
      user_email: 'remote-private-rpp0363-author@example.test',
      display_name: 'Remote Private RPP-0363 Author',
    };
  }

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function assertSha256(value, label = 'sha256') {
  assert.match(value, hashPattern, label);
}

function assertNoRawPayloads(value, payloads, label) {
  const json = JSON.stringify(value);
  for (const payload of payloads) {
    assert.equal(json.includes(payload), false, `${label} leaked raw payload ${payload}`);
  }
}

function assertHashOnlyChangeEvidence(entry, payloads, label) {
  for (const hash of [
    entry.baseHash,
    entry.localHash,
    entry.remoteHash,
    entry.change.base.hash,
    entry.change.local.hash,
    entry.change.remote.hash,
  ]) {
    assertSha256(hash, `${label} hash`);
  }
  assert.equal(Object.hasOwn(entry.change.local, 'value'), false, `${label} leaked local value`);
  assert.equal(Object.hasOwn(entry.change.remote, 'value'), false, `${label} leaked remote value`);
  assertNoRawPayloads(entry, payloads, label);
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  }
}

function focusedReadyEvidence({ plan, mutation, precondition, applied }) {
  return {
    rpp: 'RPP-0363',
    evidenceSource: 'local-focused-post-author-reference-v4',
    productionBacked: false,
    status: plan.status,
    summary: plan.summary,
    mutation: {
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      plannedPostAuthor: deserializeResourceValue(mutation.value).post_author,
    },
    precondition: {
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      journalHash: `sha256:${digest(applied.journal)}`,
    },
  };
}

function focusedStaleEvidence({ plan, blocker, reference, error }) {
  return {
    rpp: 'RPP-0363',
    evidenceSource: 'local-focused-post-author-reference-v4',
    productionBacked: false,
    status: plan.status,
    summary: plan.summary,
    authorDecision: {
      resourceKey: decisionFor(plan, authorResourceKey)?.resourceKey || null,
      decision: decisionFor(plan, authorResourceKey)?.decision || null,
      decisionHash: `sha256:${digest(decisionFor(plan, authorResourceKey) || null)}`,
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      reasonHash: `sha256:${digest(blocker.reason)}`,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      changeHash: `sha256:${digest(blocker.change)}`,
    },
    reference: {
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      targetResourceKey: reference.targetResourceKey,
      targetBaseHash: reference.targetBaseHash,
      targetLocalHash: reference.targetLocalHash,
      targetRemoteHash: reference.targetRemoteHash,
      targetLocalChange: reference.targetChange.localChange,
      targetRemoteChange: reference.targetChange.remoteChange,
      targetChangeHash: `sha256:${digest(reference.targetChange)}`,
    },
    applyRefusal: {
      code: error.code,
      detailsHash: `sha256:${digest(error.details)}`,
    },
  };
}

test('RPP-0363 plans post_author when the author target identity is stable', () => {
  const testCase = postAuthorCase();
  const plan = planFor(testCase);
  const mutation = mutationFor(plan, postResourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === postResourceKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const plannedPost = deserializeResourceValue(mutation.value);
  const evidence = focusedReadyEvidence({ plan, mutation, precondition, applied });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(decisionFor(plan, authorResourceKey), undefined);
  assert.ok(mutation, 'missing authored post mutation');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, postResourceKey);
  assert.equal(plannedPost.post_author, authorId);
  assert.equal(mutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.ok(precondition, 'missing authored post live precondition');
  assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.deepEqual(applied.site.db.wp_posts[postRowId], testCase.local.db.wp_posts[postRowId]);
  assert.deepEqual(applied.site.db.wp_users[authorRowId], testCase.remote.db.wp_users[authorRowId]);
  assertNoRawPayloads(plan, rawUserPayloads, 'ready post_author plan');
  assertNoRawPayloads(evidence, rawUserPayloads, 'ready post_author evidence');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, {
    label: 'RPP-0363 ready post_author evidence',
  }));
});

test('RPP-0363 blocks stale post_author targets with hash-only reference evidence', () => {
  const testCase = postAuthorCase({ staleAuthor: true });
  const plan = planFor(testCase);
  const blocker = blockerFor(plan, postResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'post-author');
  const remoteBefore = cloneJson(testCase.remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const evidence = focusedStaleEvidence({ plan, blocker, reference, error });
  const forbiddenPayloads = [...rawUserPayloads, ...rawStalePostPayloads];

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, postResourceKey), undefined);
  assert.equal(decisionFor(plan, authorResourceKey).decision, 'keep-remote');
  assert.ok(blocker, 'missing stale post_author blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assertHashOnlyChangeEvidence(blocker, forbiddenPayloads, 'stale post_author blocker');
  assert.ok(reference, 'missing post_author reference evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_author');
  assert.equal(reference.targetResourceKey, authorResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
    reference.targetChange.base.hash,
    reference.targetChange.local.hash,
    reference.targetChange.remote.hash,
  ]) {
    assertSha256(hash, 'stale post_author target hash');
  }
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
  assertNoRawPayloads(reference, forbiddenPayloads, 'stale post_author reference');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked post_author plan must refuse before mutation');
  assertNoRawPayloads(plan, forbiddenPayloads, 'stale post_author plan');
  assertNoRawPayloads(error.details, forbiddenPayloads, 'stale post_author apply refusal');
  assertNoRawPayloads(evidence, forbiddenPayloads, 'stale post_author evidence');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(plan, {
    label: 'RPP-0363 stale post_author plan',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(error.details, {
    label: 'RPP-0363 stale post_author refusal details',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, {
    label: 'RPP-0363 stale post_author evidence',
  }));
});
