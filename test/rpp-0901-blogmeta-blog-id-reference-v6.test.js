import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourceBlogId = 901;
const targetBlogId = 1901;
const sourceBlogRowId = `blog_id:${sourceBlogId}`;
const targetBlogRowId = `blog_id:${targetBlogId}`;
const metaKey = '_rpp0901_blog_id_reference_v6';
const sourceBlogResourceKey = rowResourceKey('wp_blogs', sourceBlogRowId);
const targetBlogResourceKey = rowResourceKey('wp_blogs', targetBlogRowId);
const sourceBlogmetaRowId = `blog_id:${sourceBlogId}:meta_key:${metaKey}`;
const rewrittenBlogmetaRowId = `blog_id:${targetBlogId}:meta_key:${metaKey}`;
const sourceBlogmetaResourceKey = rowResourceKey('wp_blogmeta', sourceBlogmetaRowId);
const rewrittenBlogmetaResourceKey = rowResourceKey('wp_blogmeta', rewrittenBlogmetaRowId);

const blogDomain = 'rpp0901-site.example.test';
const privateBlogmetaPayload = 'local-private-rpp-0901-blogmeta-payload';
const remoteDriftDomain = 'remote-private-rpp0901-site.example.test';

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
      wp_site: {
        'id:1': {
          id: 1,
          domain: 'network.example.test',
          path: '/',
        },
      },
      wp_blogs: {},
      wp_blogmeta: {},
    },
  };
}

function mappedBlogRow(blogId) {
  return {
    blog_id: blogId,
    site_id: 1,
    domain: blogDomain,
    path: '/rpp0901/',
    public: 1,
    archived: 0,
    mature: 0,
    spam: 0,
    deleted: 0,
  };
}

function mappedBlogmetaRow(blogId) {
  return {
    blog_id: blogId,
    meta_key: metaKey,
    meta_value: privateBlogmetaPayload,
  };
}

function mappedBlogmetaSite({ staleTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        {
          contractVersion: 1,
          contractKind: 'wordpress-graph-identity-map',
          sourceResourceKey: sourceBlogResourceKey,
          targetResourceKey: targetBlogResourceKey,
        },
      ],
    },
  };
  local.db.wp_blogs[sourceBlogRowId] = mappedBlogRow(sourceBlogId);
  local.db.wp_blogmeta[sourceBlogmetaRowId] = mappedBlogmetaRow(sourceBlogId);
  remote.db.wp_blogs[targetBlogRowId] = mappedBlogRow(targetBlogId);
  if (staleTarget) {
    remote.db.wp_blogs[targetBlogRowId].domain = remoteDriftDomain;
  }

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

function assertNoRawRows(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [privateBlogmetaPayload, blogDomain, remoteDriftDomain]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('RPP-0901 rewrites mapped wp_blogmeta.blog_id payload and composite row id through apply', () => {
  const { base, local, remote } = mappedBlogmetaSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const sourceDecision = decisionFor(plan, sourceBlogResourceKey);
  const targetDecision = decisionFor(plan, targetBlogResourceKey);
  const mutation = mutationFor(plan, rewrittenBlogmetaResourceKey);
  const plannedBlogmeta = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'blogmeta-blog');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourceBlogResourceKey), undefined);
  assert.equal(mutationFor(plan, targetBlogResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceBlogmetaResourceKey), undefined);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetBlogResourceKey);
  assert.equal(sourceDecision.identityMapContractValidationEvidence.reasonCode, 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED');
  assert.equal(targetDecision.decision, 'keep-remote');

  assert.ok(mutation, 'missing rewritten blogmeta mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, rewrittenBlogmetaResourceKey);
  assert.deepEqual(plannedBlogmeta, mappedBlogmetaRow(targetBlogId));
  assert.ok(rewrite, 'missing blogmeta-blog rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_blogmeta.blog_id');
  assert.equal(rewrite.field, 'blog_id');
  assert.equal(rewrite.sourceResourceKey, sourceBlogmetaResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, rewrittenBlogmetaResourceKey);
  assert.equal(rewrite.sourceTargetResourceKey, sourceBlogResourceKey);
  assert.equal(rewrite.targetResourceKey, targetBlogResourceKey);
  assert.equal(rewrite.identityMapContractHash, sourceDecision.identityMapContractValidationEvidence.contractHash);
  assert.equal(rewrite.identityMapContractValidationHash, digest(sourceDecision.identityMapContractValidationEvidence));
  assert.match(rewrite.relationshipContractHash, hashPattern);
  assert.match(rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(rewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_blogs[sourceBlogRowId], undefined);
  assert.equal(result.site.db.wp_blogs[targetBlogRowId].blog_id, targetBlogId);
  assert.equal(result.site.db.wp_blogmeta[sourceBlogmetaRowId], undefined);
  assert.deepEqual(result.site.db.wp_blogmeta[rewrittenBlogmetaRowId], mappedBlogmetaRow(targetBlogId));
  assertNoRawRows({ sourceDecision, targetDecision, rewrite });
});

test('RPP-0901 apply refuses forged wp_blogmeta.blog_id rewrite payload before mutation', () => {
  const { base, local, remote } = mappedBlogmetaSite();
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBefore = JSON.stringify(forgedRemote);
  const mutation = mutationFor(forgedPlan, rewrittenBlogmetaResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.blog_id = sourceBlogId;
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged blogmeta rewrite payload issue');
  assert.equal(issue.resourceKey, rewrittenBlogmetaResourceKey);
  assert.equal(issue.relationshipType, 'blogmeta-blog');
  assert.equal(issue.field, 'blog_id');
  assert.equal(issue.targetResourceKey, targetBlogResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(JSON.stringify(forgedRemote), forgedRemoteBefore);
  assert.equal(forgedRemote.db.wp_blogmeta[rewrittenBlogmetaRowId], undefined);
});

test('RPP-0901 blocks stale wp_blogmeta.blog_id identity maps with hash-only evidence', () => {
  const { base, local, remote } = mappedBlogmetaSite({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourceBlogResourceKey);
  const blogmetaBlocker = blockerFor(plan, sourceBlogmetaResourceKey);
  const blogReference = blogmetaBlocker?.references.find((entry) =>
    entry.relationshipType === 'blogmeta-blog');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 2);
  assert.equal(mutationFor(plan, sourceBlogResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceBlogmetaResourceKey), undefined);
  assert.equal(mutationFor(plan, rewrittenBlogmetaResourceKey), undefined);

  assert.ok(sourceBlocker, 'missing source blog identity-map blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(blogmetaBlocker, 'missing blogmeta reference blocker');
  assert.equal(blogmetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(blogmetaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(blogReference, 'missing blogmeta-blog target evidence');
  assert.equal(blogReference.relationshipKey, 'wp_blogmeta.blog_id');
  assert.equal(blogReference.sourceResourceKey, sourceBlogmetaResourceKey);
  assert.equal(blogReference.targetResourceKey, sourceBlogResourceKey);
  assert.equal(blogReference.targetSupport.supported, false);
  assert.match(blogReference.targetSupport.reason, /not equivalent after identity rewriting/);
  for (const hash of [
    sourceBlocker.baseHash,
    sourceBlocker.localHash,
    sourceBlocker.remoteHash,
    blogmetaBlocker.baseHash,
    blogmetaBlocker.localHash,
    blogmetaBlocker.remoteHash,
    blogReference.targetBaseHash,
    blogReference.targetLocalHash,
    blogReference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked blogmeta plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_blogmeta[rewrittenBlogmetaRowId], undefined);
  assertNoRawRows(plan);
});
