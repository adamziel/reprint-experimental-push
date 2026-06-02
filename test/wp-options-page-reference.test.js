import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourcePageId = 88101;
const targetPageId = 98101;
const samePlanPageId = 88102;
const wrongPostId = 88103;
const sourcePageRowId = `ID:${sourcePageId}`;
const targetPageRowId = `ID:${targetPageId}`;
const samePlanPageRowId = `ID:${samePlanPageId}`;
const wrongPostRowId = `ID:${wrongPostId}`;
const sourcePageResourceKey = rowResourceKey('wp_posts', sourcePageRowId);
const targetPageResourceKey = rowResourceKey('wp_posts', targetPageRowId);
const pageOnFrontResourceKey = rowResourceKey('wp_options', 'option_name:page_on_front');
const pageForPostsResourceKey = rowResourceKey('wp_options', 'option_name:page_for_posts');
const missingPageResourceKey = rowResourceKey('wp_posts', 'ID:999999');
const wrongPostResourceKey = rowResourceKey('wp_posts', wrongPostRowId);

const pageTitle = 'RPP mapped front page';
const pageName = 'rpp-mapped-front-page';

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
      wp_posts: {},
      wp_options: {},
    },
  };
}

function pageRow(id, overrides = {}) {
  return {
    ID: id,
    post_title: pageTitle,
    post_name: pageName,
    post_content: 'RPP mapped front page content',
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
    ...overrides,
  };
}

function optionRow(name, value) {
  return {
    option_name: name,
    option_value: value,
    autoload: 'yes',
  };
}

function explicitIdentityMapRow(sourceResourceKey, targetResourceKey) {
  return {
    contractVersion: 1,
    contractKind: 'wordpress-graph-identity-map',
    sourceResourceKey,
    targetResourceKey,
  };
}

function mappedOptionSite(optionName = 'page_on_front') {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        explicitIdentityMapRow(sourcePageResourceKey, targetPageResourceKey),
      ],
    },
  };
  local.db.wp_posts[sourcePageRowId] = pageRow(sourcePageId);
  local.db.wp_options[`option_name:${optionName}`] = optionRow(optionName, String(sourcePageId));
  remote.db.wp_posts[targetPageRowId] = pageRow(targetPageId);

  return { base, local, remote };
}

function planFor(base, local, remote) {
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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

function assertHashOnlyChangeEvidence(entry) {
  for (const hash of [
    entry.baseHash,
    entry.localHash,
    entry.remoteHash,
    entry.change.base.hash,
    entry.change.local.hash,
    entry.change.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(entry.change.base, 'value'), false);
  assert.equal(Object.hasOwn(entry.change.local, 'value'), false);
  assert.equal(Object.hasOwn(entry.change.remote, 'value'), false);
}

function assertNoRawRows(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [pageTitle, pageName]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('rewrites mapped page_on_front option through a proven page identity map', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const mutation = mutationFor(plan, pageOnFrontResourceKey);
  const plannedOption = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'option-page-on-front-post');

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, sourcePageResourceKey), undefined);
  assert.equal(decisionFor(plan, sourcePageResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetPageResourceKey).decision, 'keep-remote');
  assert.equal(mutation.resourceKey, pageOnFrontResourceKey);
  assert.equal(mutation.changeKind, 'create');
  assert.deepEqual(plannedOption, optionRow('page_on_front', String(targetPageId)));

  assert.ok(rewrite, 'missing page_on_front rewrite proof');
  assert.equal(rewrite.relationshipKey, 'wp_options.option_value');
  assert.equal(rewrite.field, 'option_value');
  assert.equal(rewrite.sourceTargetResourceKey, sourcePageResourceKey);
  assert.equal(rewrite.targetResourceKey, targetPageResourceKey);
  assert.match(rewrite.relationshipContractHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_posts[sourcePageRowId], undefined);
  assert.equal(result.site.db.wp_posts[targetPageRowId].ID, targetPageId);
  assert.deepEqual(
    result.site.db.wp_options['option_name:page_on_front'],
    optionRow('page_on_front', String(targetPageId)),
  );
  assertNoRawRows({ plan, rewrite });
});

test('plans page_for_posts against an unchanged existing page target without rewrite', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  base.db.wp_posts[targetPageRowId] = pageRow(targetPageId);
  local.db.wp_posts[targetPageRowId] = pageRow(targetPageId);
  remote.db.wp_posts[targetPageRowId] = pageRow(targetPageId);
  local.db.wp_options['option_name:page_for_posts'] = optionRow('page_for_posts', String(targetPageId));

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, pageForPostsResourceKey);
  const plannedOption = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutation.changeKind, 'create');
  assert.equal(plannedOption.option_value, String(targetPageId));
  assert.equal(mutation.wordpressGraphIdentity, undefined);
});

test('rewrites numeric page_for_posts option values without changing scalar type', () => {
  const { base, local, remote } = mappedOptionSite('page_for_posts');
  local.db.wp_options['option_name:page_for_posts'].option_value = sourcePageId;

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const mutation = mutationFor(plan, pageForPostsResourceKey);
  const plannedOption = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'option-page-for-posts-post');

  assert.equal(plan.status, 'ready');
  assert.ok(rewrite, 'missing page_for_posts rewrite proof');
  assert.equal(rewrite.relationshipKey, 'wp_options.option_value');
  assert.equal(plannedOption.option_value, targetPageId);
  assert.equal(typeof plannedOption.option_value, 'number');
  assert.equal(result.site.db.wp_options['option_name:page_for_posts'].option_value, targetPageId);
});

test('accepts same-plan page creation for page_for_posts option targets', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_posts[samePlanPageRowId] = pageRow(samePlanPageId, {
    post_title: 'RPP same-plan page',
    post_name: 'rpp-same-plan-page',
  });
  local.db.wp_options['option_name:page_for_posts'] = optionRow('page_for_posts', String(samePlanPageId));

  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const optionMutation = mutationFor(plan, pageForPostsResourceKey);
  const pageMutation = mutationFor(plan, rowResourceKey('wp_posts', samePlanPageRowId));

  assert.equal(plan.status, 'ready');
  assert.ok(optionMutation, 'missing page_for_posts mutation');
  assert.ok(pageMutation, 'missing same-plan page mutation');
  assert.equal(optionMutation.wordpressGraphIdentity, undefined);
  assert.equal(result.appliedMutations, 2);
  assert.equal(result.site.db.wp_posts[samePlanPageRowId].ID, samePlanPageId);
  assert.equal(result.site.db.wp_options['option_name:page_for_posts'].option_value, String(samePlanPageId));
});

test('blocks page_on_front option references when the page target is missing', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_options['option_name:page_on_front'] = optionRow('page_on_front', '999999');

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, pageOnFrontResourceKey);
  const optionReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'option-page-on-front-post');

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, pageOnFrontResourceKey), undefined);
  assert.ok(optionReference, 'missing page_on_front missing-target evidence');
  assert.equal(optionReference.relationshipKey, 'wp_options.option_value');
  assert.equal(optionReference.targetResourceKey, missingPageResourceKey);
  assert.equal(optionReference.targetChange.remote.state, 'absent');
  assert.match(optionReference.targetRemoteHash, hashPattern);
  assertNoRawRows({ blocker, optionReference });
});

test('blocks option page references when the target post is not a page', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const wrongPost = pageRow(wrongPostId, {
    post_type: 'post',
    post_title: 'RPP not a page target',
    post_name: 'rpp-not-a-page-target',
  });
  base.db.wp_posts[wrongPostRowId] = wrongPost;
  local.db.wp_posts[wrongPostRowId] = wrongPost;
  remote.db.wp_posts[wrongPostRowId] = wrongPost;
  local.db.wp_options['option_name:page_on_front'] = optionRow('page_on_front', String(wrongPostId));

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan, pageOnFrontResourceKey);
  const optionReference = blocker?.references.find((reference) =>
    reference.relationshipType === 'option-page-on-front-post');

  assert.equal(plan.status, 'blocked');
  assert.ok(optionReference, 'missing non-page target evidence');
  assert.equal(optionReference.targetResourceKey, wrongPostResourceKey);
  assert.deepEqual(optionReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${pageOnFrontResourceKey} references an option page target that is not a supported page row.`,
  });
  assertHashOnlyChangeEvidence(blocker);
  assertNoRawRows({ blocker, optionReference });
});

test('does not emit option page references for other options or non-positive values', () => {
  for (const [optionName, optionValue] of [
    ['show_on_front', String(targetPageId)],
    ['page_on_front', ''],
    ['page_on_front', '0'],
    ['page_on_front', 'not-an-integer'],
    ['page_for_posts', 0],
  ]) {
    const resourceKey = rowResourceKey('wp_options', `option_name:${optionName}`);
    const base = baseSite();
    const local = cloneJson(base);
    const remote = cloneJson(base);
    local.db.wp_options[`option_name:${optionName}`] = optionRow(optionName, optionValue);

    const plan = planFor(base, local, remote);
    const mutation = mutationFor(plan, resourceKey);
    const serializedEvidence = JSON.stringify([
      blockerFor(plan, resourceKey),
      mutation?.wordpressGraphIdentity,
    ]);

    assert.equal(plan.status, 'ready', `${optionName}:${optionValue} should not emit a page graph blocker`);
    assert.ok(mutation, `missing mutation for ${optionName}:${optionValue}`);
    assert.equal(serializedEvidence.includes('option-page-on-front-post'), false);
    assert.equal(serializedEvidence.includes('option-page-for-posts-post'), false);
  }
});

test('apply refuses forged option page rewrite payload before mutation', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const remoteBeforeHash = digest(forgedRemote);
  const mutation = mutationFor(forgedPlan, pageOnFrontResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.option_value = String(sourcePageId);
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged option page rewrite payload issue');
  assert.equal(issue.resourceKey, pageOnFrontResourceKey);
  assert.equal(issue.relationshipKey, 'wp_options.option_value');
  assert.equal(issue.field, 'option_value');
  assert.equal(issue.targetResourceKey, targetPageResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(digest(forgedRemote), remoteBeforeHash);
  assert.equal(forgedRemote.db.wp_options['option_name:page_on_front'], undefined);
});

test('apply refuses option page rewrites without a carried identity-map decision', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const remoteBeforeHash = digest(forgedRemote);
  forgedPlan.decisions = forgedPlan.decisions.filter((decision) =>
    decision.resourceKey !== sourcePageResourceKey);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_IDENTITY_MAP_DECISION_MISSING'
    && entry.relationshipType === 'option-page-on-front-post');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing stripped identity-map decision issue');
  assert.equal(issue.sourceTargetResourceKey, sourcePageResourceKey);
  assert.equal(digest(forgedRemote), remoteBeforeHash);
  assert.equal(forgedRemote.db.wp_options['option_name:page_on_front'], undefined);
});

test('apply refuses option page rewrites when carried target hash no longer matches the identity decision', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const remoteBeforeHash = digest(forgedRemote);
  const mutation = mutationFor(forgedPlan, pageOnFrontResourceKey);
  const rewrite = mutation.wordpressGraphIdentity.rewrites.find((entry) =>
    entry.relationshipType === 'option-page-on-front-post');
  rewrite.targetRemoteHash = '0'.repeat(64);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const decisionIssue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_IDENTITY_MAP_DECISION_TARGET_HASH_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');
  const liveTargetIssue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_REMOTE_HASH_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(decisionIssue, 'missing identity decision target hash mismatch issue');
  assert.ok(liveTargetIssue, 'missing live target hash mismatch issue');
  assert.equal(liveTargetIssue.targetResourceKey, targetPageResourceKey);
  assert.equal(digest(forgedRemote), remoteBeforeHash);
});

test('apply refuses option page rewrites when the live mapped target drifts from page to post', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const forgedRemote = cloneJson(remote);
  forgedRemote.db.wp_posts[targetPageRowId].post_type = 'post';
  const remoteBeforeHash = digest(forgedRemote);

  const error = captureError(() => applyPlan(forgedRemote, plan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_REMOTE_HASH_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');
  const typeIssue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_POST_TYPE_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing live target drift hash issue');
  assert.ok(typeIssue, 'missing target post type mismatch issue');
  assert.equal(typeIssue.requiredPostType, 'page');
  assert.match(typeIssue.observedPostTypeHash, hashPattern);
  assert.equal(digest(forgedRemote), remoteBeforeHash);
  assert.equal(forgedRemote.db.wp_options['option_name:page_on_front'], undefined);
});

test('apply refuses option page rewrites when the option row no longer satisfies the source condition', () => {
  const { base, local, remote } = mappedOptionSite('page_on_front');
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const remoteBeforeHash = digest(forgedRemote);
  const mutation = mutationFor(forgedPlan, pageOnFrontResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.option_name = 'page_for_posts';
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_SOURCE_CONTRACT_MISMATCH'
    && entry.relationshipType === 'option-page-on-front-post');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing option source condition issue');
  assert.equal(issue.sourceSuffix, 'options');
  assert.equal(issue.sourceCondition, 'option_name:page_on_front');
  assert.equal(digest(forgedRemote), remoteBeforeHash);
  assert.equal(forgedRemote.db.wp_options['option_name:page_on_front'], undefined);
});
