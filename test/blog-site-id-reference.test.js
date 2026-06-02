import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourceSiteId = 903;
const targetSiteId = 1903;
const blogId = 909;
const sourceSiteRowId = `id:${sourceSiteId}`;
const targetSiteRowId = `id:${targetSiteId}`;
const blogRowId = `blog_id:${blogId}`;
const sourceSiteResourceKey = rowResourceKey('wp_site', sourceSiteRowId);
const targetSiteResourceKey = rowResourceKey('wp_site', targetSiteRowId);
const blogResourceKey = rowResourceKey('wp_blogs', blogRowId);

const siteDomain = 'rpp-blog-site-network.example.test';
const blogDomain = 'rpp-blog-site-blog.example.test';
const remoteDriftDomain = 'remote-private-rpp-blog-site-network.example.test';

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
      wp_site: {},
      wp_blogs: {},
    },
  };
}

function mappedSiteRow(siteId) {
  return {
    id: siteId,
    domain: siteDomain,
    path: '/',
  };
}

function mappedBlogRow(siteId) {
  return {
    blog_id: blogId,
    site_id: siteId,
    domain: blogDomain,
    path: '/blog-site-reference/',
    public: 1,
    archived: 0,
    mature: 0,
    spam: 0,
    deleted: 0,
  };
}

function mappedBlogSite({ staleTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        {
          contractVersion: 1,
          contractKind: 'wordpress-graph-identity-map',
          sourceResourceKey: sourceSiteResourceKey,
          targetResourceKey: targetSiteResourceKey,
        },
      ],
    },
  };
  local.db.wp_site[sourceSiteRowId] = mappedSiteRow(sourceSiteId);
  local.db.wp_blogs[blogRowId] = mappedBlogRow(sourceSiteId);
  remote.db.wp_site[targetSiteRowId] = mappedSiteRow(targetSiteId);
  if (staleTarget) {
    remote.db.wp_site[targetSiteRowId].domain = remoteDriftDomain;
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
  for (const forbidden of [blogDomain, siteDomain, remoteDriftDomain]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('rewrites mapped wp_blogs.site_id payload through apply without changing the blog row key', () => {
  const { base, local, remote } = mappedBlogSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const sourceDecision = decisionFor(plan, sourceSiteResourceKey);
  const targetDecision = decisionFor(plan, targetSiteResourceKey);
  const mutation = mutationFor(plan, blogResourceKey);
  const plannedBlog = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'blog-site');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourceSiteResourceKey), undefined);
  assert.equal(mutationFor(plan, targetSiteResourceKey), undefined);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetSiteResourceKey);
  assert.equal(sourceDecision.identityMapContractValidationEvidence.reasonCode, 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED');
  assert.equal(targetDecision.decision, 'keep-remote');

  assert.ok(mutation, 'missing rewritten wp_blogs mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, blogResourceKey);
  assert.deepEqual(plannedBlog, mappedBlogRow(targetSiteId));
  assert.ok(rewrite, 'missing blog-site rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_blogs.site_id');
  assert.equal(rewrite.field, 'site_id');
  assert.equal(rewrite.sourceResourceKey, blogResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, blogResourceKey);
  assert.equal(rewrite.sourceTargetResourceKey, sourceSiteResourceKey);
  assert.equal(rewrite.targetResourceKey, targetSiteResourceKey);
  assert.equal(rewrite.identityMapContractHash, sourceDecision.identityMapContractValidationEvidence.contractHash);
  assert.equal(rewrite.identityMapContractValidationHash, digest(sourceDecision.identityMapContractValidationEvidence));
  assert.match(rewrite.relationshipContractHash, hashPattern);
  assert.match(rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(rewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_site[sourceSiteRowId], undefined);
  assert.equal(result.site.db.wp_site[targetSiteRowId].id, targetSiteId);
  assert.deepEqual(result.site.db.wp_blogs[blogRowId], mappedBlogRow(targetSiteId));
  assertNoRawRows({ sourceDecision, targetDecision, rewrite });
});

test('apply refuses forged wp_blogs.site_id rewrite payload before mutation', () => {
  const { base, local, remote } = mappedBlogSite();
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBefore = JSON.stringify(forgedRemote);
  const mutation = mutationFor(forgedPlan, blogResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.site_id = sourceSiteId;
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged blog-site rewrite payload issue');
  assert.equal(issue.resourceKey, blogResourceKey);
  assert.equal(issue.relationshipType, 'blog-site');
  assert.equal(issue.field, 'site_id');
  assert.equal(issue.targetResourceKey, targetSiteResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(JSON.stringify(forgedRemote), forgedRemoteBefore);
  assert.equal(forgedRemote.db.wp_blogs[blogRowId], undefined);
});

test('blocks stale wp_blogs.site_id identity maps with hash-only evidence', () => {
  const { base, local, remote } = mappedBlogSite({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourceSiteResourceKey);
  const blogBlocker = blockerFor(plan, blogResourceKey);
  const siteReference = blogBlocker?.references.find((entry) =>
    entry.relationshipType === 'blog-site');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 2);
  assert.equal(mutationFor(plan, sourceSiteResourceKey), undefined);
  assert.equal(mutationFor(plan, blogResourceKey), undefined);

  assert.ok(sourceBlocker, 'missing source site identity-map blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(blogBlocker, 'missing blog-site reference blocker');
  assert.equal(blogBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(blogBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(siteReference, 'missing blog-site target evidence');
  assert.equal(siteReference.relationshipKey, 'wp_blogs.site_id');
  assert.equal(siteReference.sourceResourceKey, blogResourceKey);
  assert.equal(siteReference.targetResourceKey, sourceSiteResourceKey);
  assert.equal(siteReference.targetSupport.supported, false);
  assert.match(siteReference.targetSupport.reason, /not equivalent after identity rewriting/);
  for (const hash of [
    sourceBlocker.baseHash,
    sourceBlocker.localHash,
    sourceBlocker.remoteHash,
    blogBlocker.baseHash,
    blogBlocker.localHash,
    blogBlocker.remoteHash,
    siteReference.targetBaseHash,
    siteReference.targetLocalHash,
    siteReference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked blog-site plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_blogs[blogRowId], undefined);
  assertNoRawRows(plan);
});
