import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourceUserId = 712;
const targetUserId = 1712;
const linkId = 719;
const sourceUserRowId = `ID:${sourceUserId}`;
const targetUserRowId = `ID:${targetUserId}`;
const linkRowId = `link_id:${linkId}`;
const sourceUserResourceKey = rowResourceKey('wp_users', sourceUserRowId);
const targetUserResourceKey = rowResourceKey('wp_users', targetUserRowId);
const linkResourceKey = rowResourceKey('wp_links', linkRowId);

const userLogin = 'rpp-link-owner-user';
const userEmail = 'rpp-link-owner-user@example.test';
const linkUrl = 'https://rpp-link-owner.example.test/private-link';
const linkName = 'RPP Link Owner Private Link';
const remoteDriftEmail = 'remote-private-rpp-link-owner-user@example.test';

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
      wp_users: {},
      wp_links: {},
    },
  };
}

function mappedUserRow(userId) {
  return {
    ID: userId,
    user_login: userLogin,
    user_email: userEmail,
    display_name: 'RPP Link Owner User',
  };
}

function mappedLinkRow(ownerId) {
  return {
    link_id: linkId,
    link_url: linkUrl,
    link_name: linkName,
    link_owner: ownerId,
    link_visible: 'Y',
    link_rating: 0,
  };
}

function mappedLinkOwner({ staleTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        {
          contractVersion: 1,
          contractKind: 'wordpress-graph-identity-map',
          sourceResourceKey: sourceUserResourceKey,
          targetResourceKey: targetUserResourceKey,
        },
      ],
    },
  };
  local.db.wp_users[sourceUserRowId] = mappedUserRow(sourceUserId);
  local.db.wp_links[linkRowId] = mappedLinkRow(sourceUserId);
  remote.db.wp_users[targetUserRowId] = mappedUserRow(targetUserId);
  if (staleTarget) {
    remote.db.wp_users[targetUserRowId].user_email = remoteDriftEmail;
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
  for (const forbidden of [userLogin, userEmail, linkUrl, linkName, remoteDriftEmail]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('rewrites mapped wp_links.link_owner payload through apply without changing the link row key', () => {
  const { base, local, remote } = mappedLinkOwner();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const sourceDecision = decisionFor(plan, sourceUserResourceKey);
  const targetDecision = decisionFor(plan, targetUserResourceKey);
  const mutation = mutationFor(plan, linkResourceKey);
  const plannedLink = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'link-owner');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourceUserResourceKey), undefined);
  assert.equal(mutationFor(plan, targetUserResourceKey), undefined);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetUserResourceKey);
  assert.equal(sourceDecision.identityMapContractValidationEvidence.reasonCode, 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED');
  assert.equal(targetDecision.decision, 'keep-remote');

  assert.ok(mutation, 'missing rewritten wp_links mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, linkResourceKey);
  assert.deepEqual(plannedLink, mappedLinkRow(targetUserId));
  assert.ok(rewrite, 'missing link-owner rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_links.link_owner');
  assert.equal(rewrite.field, 'link_owner');
  assert.equal(rewrite.sourceResourceKey, linkResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, linkResourceKey);
  assert.equal(rewrite.sourceTargetResourceKey, sourceUserResourceKey);
  assert.equal(rewrite.targetResourceKey, targetUserResourceKey);
  assert.equal(rewrite.identityMapContractHash, sourceDecision.identityMapContractValidationEvidence.contractHash);
  assert.equal(rewrite.identityMapContractValidationHash, digest(sourceDecision.identityMapContractValidationEvidence));
  assert.match(rewrite.relationshipContractHash, hashPattern);
  assert.match(rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(rewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_users[sourceUserRowId], undefined);
  assert.equal(result.site.db.wp_users[targetUserRowId].ID, targetUserId);
  assert.deepEqual(result.site.db.wp_links[linkRowId], mappedLinkRow(targetUserId));
  assertNoRawRows({ sourceDecision, targetDecision, rewrite });
});

test('apply refuses forged wp_links.link_owner rewrite payload before mutation', () => {
  const { base, local, remote } = mappedLinkOwner();
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBefore = JSON.stringify(forgedRemote);
  const mutation = mutationFor(forgedPlan, linkResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.link_owner = sourceUserId;
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged link-owner rewrite payload issue');
  assert.equal(issue.resourceKey, linkResourceKey);
  assert.equal(issue.relationshipType, 'link-owner');
  assert.equal(issue.field, 'link_owner');
  assert.equal(issue.targetResourceKey, targetUserResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(JSON.stringify(forgedRemote), forgedRemoteBefore);
  assert.equal(forgedRemote.db.wp_links[linkRowId], undefined);
});

test('blocks stale wp_links.link_owner identity maps with hash-only evidence', () => {
  const { base, local, remote } = mappedLinkOwner({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourceUserResourceKey);
  const linkBlocker = blockerFor(plan, linkResourceKey);
  const ownerReference = linkBlocker?.references.find((entry) =>
    entry.relationshipType === 'link-owner');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 2);
  assert.equal(mutationFor(plan, sourceUserResourceKey), undefined);
  assert.equal(mutationFor(plan, linkResourceKey), undefined);

  assert.ok(sourceBlocker, 'missing source user identity-map blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(linkBlocker, 'missing link-owner reference blocker');
  assert.equal(linkBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(linkBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(ownerReference, 'missing link-owner target evidence');
  assert.equal(ownerReference.relationshipKey, 'wp_links.link_owner');
  assert.equal(ownerReference.sourceResourceKey, linkResourceKey);
  assert.equal(ownerReference.targetResourceKey, sourceUserResourceKey);
  assert.equal(ownerReference.targetSupport.supported, false);
  assert.match(ownerReference.targetSupport.reason, /not equivalent after identity rewriting/);
  for (const hash of [
    sourceBlocker.baseHash,
    sourceBlocker.localHash,
    sourceBlocker.remoteHash,
    linkBlocker.baseHash,
    linkBlocker.localHash,
    linkBlocker.remoteHash,
    ownerReference.targetBaseHash,
    ownerReference.targetLocalHash,
    ownerReference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked link-owner plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_links[linkRowId], undefined);
  assertNoRawRows(plan);
});
