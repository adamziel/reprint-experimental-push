import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const sourceSiteId = 902;
const targetSiteId = 1902;
const sourceSiteRowId = `id:${sourceSiteId}`;
const targetSiteRowId = `id:${targetSiteId}`;
const metaKey = '_rpp_sitemeta_site_id_reference';
const sourceSiteResourceKey = rowResourceKey('wp_site', sourceSiteRowId);
const targetSiteResourceKey = rowResourceKey('wp_site', targetSiteRowId);
const sourceSitemetaRowId = `site_id:${sourceSiteId}:meta_key:${metaKey}`;
const rewrittenSitemetaRowId = `site_id:${targetSiteId}:meta_key:${metaKey}`;
const sourceSitemetaResourceKey = rowResourceKey('wp_sitemeta', sourceSitemetaRowId);
const rewrittenSitemetaResourceKey = rowResourceKey('wp_sitemeta', rewrittenSitemetaRowId);

const siteDomain = 'rpp-sitemeta-network.example.test';
const privateSitemetaPayload = 'local-private-sitemeta-reference-payload';
const remoteDriftDomain = 'remote-private-rpp-sitemeta-network.example.test';

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
      wp_sitemeta: {},
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

function mappedSitemetaRow(siteId) {
  return {
    site_id: siteId,
    meta_key: metaKey,
    meta_value: privateSitemetaPayload,
  };
}

function mappedSitemetaSite({ staleTarget = false } = {}) {
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
  local.db.wp_sitemeta[sourceSitemetaRowId] = mappedSitemetaRow(sourceSiteId);
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
  for (const forbidden of [privateSitemetaPayload, siteDomain, remoteDriftDomain]) {
    assert.equal(serialized.includes(forbidden), false, `leaked raw value ${forbidden}`);
  }
}

test('rewrites mapped wp_sitemeta.site_id payload and composite row id through apply', () => {
  const { base, local, remote } = mappedSitemetaSite();
  const plan = planFor(base, local, remote);
  const result = applyPlan(cloneJson(remote), plan);
  const sourceDecision = decisionFor(plan, sourceSiteResourceKey);
  const targetDecision = decisionFor(plan, targetSiteResourceKey);
  const mutation = mutationFor(plan, rewrittenSitemetaResourceKey);
  const plannedSitemeta = deserializeResourceValue(mutation.value);
  const rewrite = mutation.wordpressGraphIdentity?.rewrites.find((entry) =>
    entry.relationshipType === 'sitemeta-site');

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
  assert.equal(mutationFor(plan, sourceSitemetaResourceKey), undefined);
  assert.equal(sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.targetResourceKey, targetSiteResourceKey);
  assert.equal(sourceDecision.identityMapContractValidationEvidence.reasonCode, 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED');
  assert.equal(targetDecision.decision, 'keep-remote');

  assert.ok(mutation, 'missing rewritten sitemeta mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'create');
  assert.equal(mutation.resourceKey, rewrittenSitemetaResourceKey);
  assert.deepEqual(plannedSitemeta, mappedSitemetaRow(targetSiteId));
  assert.ok(rewrite, 'missing sitemeta-site rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_sitemeta.site_id');
  assert.equal(rewrite.field, 'site_id');
  assert.equal(rewrite.sourceResourceKey, sourceSitemetaResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, rewrittenSitemetaResourceKey);
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
  assert.equal(result.site.db.wp_sitemeta[sourceSitemetaRowId], undefined);
  assert.deepEqual(result.site.db.wp_sitemeta[rewrittenSitemetaRowId], mappedSitemetaRow(targetSiteId));
  assertNoRawRows({ sourceDecision, targetDecision, rewrite });
});

test('apply refuses forged wp_sitemeta.site_id rewrite payload before mutation', () => {
  const { base, local, remote } = mappedSitemetaSite();
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedRemote = cloneJson(remote);
  const forgedRemoteBefore = JSON.stringify(forgedRemote);
  const mutation = mutationFor(forgedPlan, rewrittenSitemetaResourceKey);
  const forgedValue = deserializeResourceValue(mutation.value);
  forgedValue.site_id = sourceSiteId;
  mutation.value = serializeResourceValue(forgedValue);
  mutation.localHash = digest(forgedValue);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));
  const issue = error.details.issues.find((entry) =>
    entry.code === 'WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH');

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(issue, 'missing forged sitemeta rewrite payload issue');
  assert.equal(issue.resourceKey, rewrittenSitemetaResourceKey);
  assert.equal(issue.relationshipType, 'sitemeta-site');
  assert.equal(issue.field, 'site_id');
  assert.equal(issue.targetResourceKey, targetSiteResourceKey);
  assert.match(issue.expectedTargetIdHash, hashPattern);
  assert.match(issue.actualTargetValueHash, hashPattern);
  assert.equal(JSON.stringify(forgedRemote), forgedRemoteBefore);
  assert.equal(forgedRemote.db.wp_sitemeta[rewrittenSitemetaRowId], undefined);
});

test('blocks stale wp_sitemeta.site_id identity maps with hash-only evidence', () => {
  const { base, local, remote } = mappedSitemetaSite({ staleTarget: true });
  const plan = planFor(base, local, remote);
  const sourceBlocker = blockerFor(plan, sourceSiteResourceKey);
  const sitemetaBlocker = blockerFor(plan, sourceSitemetaResourceKey);
  const siteReference = sitemetaBlocker?.references.find((entry) =>
    entry.relationshipType === 'sitemeta-site');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 2);
  assert.equal(mutationFor(plan, sourceSiteResourceKey), undefined);
  assert.equal(mutationFor(plan, sourceSitemetaResourceKey), undefined);
  assert.equal(mutationFor(plan, rewrittenSitemetaResourceKey), undefined);

  assert.ok(sourceBlocker, 'missing source site identity-map blocker');
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(sitemetaBlocker, 'missing sitemeta reference blocker');
  assert.equal(sitemetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sitemetaBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.ok(siteReference, 'missing sitemeta-site target evidence');
  assert.equal(siteReference.relationshipKey, 'wp_sitemeta.site_id');
  assert.equal(siteReference.sourceResourceKey, sourceSitemetaResourceKey);
  assert.equal(siteReference.targetResourceKey, sourceSiteResourceKey);
  assert.equal(siteReference.targetSupport.supported, false);
  assert.match(siteReference.targetSupport.reason, /not equivalent after identity rewriting/);
  for (const hash of [
    sourceBlocker.baseHash,
    sourceBlocker.localHash,
    sourceBlocker.remoteHash,
    sitemetaBlocker.baseHash,
    sitemetaBlocker.localHash,
    sitemetaBlocker.remoteHash,
    siteReference.targetBaseHash,
    siteReference.targetLocalHash,
    siteReference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked sitemeta plan must refuse before mutation');
  assert.equal(remoteBefore.db.wp_sitemeta[rewrittenSitemetaRowId], undefined);
  assertNoRawRows(plan);
});
