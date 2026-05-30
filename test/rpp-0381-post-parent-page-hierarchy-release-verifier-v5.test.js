import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const parentId = 38101;
const childId = 38102;
const parentRowId = `ID:${parentId}`;
const childRowId = `ID:${childId}`;
const parentResourceKey = rowResourceKey('wp_posts', parentRowId);
const childResourceKey = rowResourceKey('wp_posts', childRowId);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function pageRow({ id, title, slug, content, parent = 0 }) {
  return {
    ID: id,
    post_title: title,
    post_name: slug,
    post_content: content,
    post_status: 'publish',
    post_type: 'page',
    post_parent: parent,
    post_author: 0,
  };
}

function baseSite() {
  return {
    files: {},
    plugins: {},
    db: {
      wp_posts: {},
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function releaseVerifierProofFor({ plan, appliedSite, localSite }) {
  const receiptHash = digest({ kind: 'rpp-0381-dry-run-receipt', plan });
  const verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);
  return {
    ok: true,
    dryRun: {
      status: 200,
      receiptHash,
    },
    apply: {
      status: 200,
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        planHash: digest(plan),
        receiptHash,
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations.map((mutation) => ({
          id: mutation.id,
          resourceKey: mutation.resourceKey,
          baseHash: mutation.baseHash,
          remoteBeforeHash: mutation.remoteBeforeHash,
          localHash: mutation.localHash,
        }))),
        verifiedCount: verifiedResourceKeys.length,
        verifiedResourceKeys,
      },
    },
    after: {
      status: 200,
      finalMatchesLocal: digest(appliedSite) === digest(localSite),
    },
    planObject: plan,
  };
}

function summarizePostParentReleaseVerifierEvidence({ proof, appliedSite }) {
  const plan = proof?.planObject || null;
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const blockers = Array.isArray(plan?.blockers) ? plan.blockers : [];
  const childMutation = mutations.find((mutation) => mutation.resourceKey === childResourceKey) || null;
  const parentMutation = mutations.find((mutation) => mutation.resourceKey === parentResourceKey) || null;
  const childPrecondition = plan ? preconditionFor(plan, childResourceKey) : null;
  const parentPrecondition = plan ? preconditionFor(plan, parentResourceKey) : null;
  const childValue = childMutation ? deserializeResourceValue(childMutation.value) : null;
  const applyRevalidation = proof?.apply?.applyRevalidation || {};
  const verifiedResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys
    : [];
  const mutationResourceKeys = mutations.map((mutation) => mutation.resourceKey);
  const parentPreconditionLive = parentMutation
    ? parentPrecondition?.checkedAgainst === 'live-remote'
      && parentPrecondition?.expectedHash === parentMutation.remoteBeforeHash
      && parentPrecondition?.expectedHash === parentMutation.baseHash
      && hashPattern.test(parentPrecondition.expectedHash)
    : false;
  const childPreconditionLive = childPrecondition?.checkedAgainst === 'live-remote'
    && childPrecondition?.expectedHash === childMutation?.remoteBeforeHash
    && childPrecondition?.expectedHash === childMutation?.baseHash
    && hashPattern.test(childPrecondition?.expectedHash || '');
  const evidence = {
    rpp: 'RPP-0381',
    evidenceSource: 'release-verifier-post-parent-page-hierarchy-v5',
    target: {
      relationshipKey: 'wp_posts.post_parent',
      relationshipType: 'post-parent',
      parentResourceKey,
      childResourceKey,
      parentId,
      childId,
    },
    plan: {
      status: plan?.status || null,
      mutationCount: mutations.length,
      blockerCount: blockers.length,
      planHash: plan ? digest(plan) : null,
    },
    mutationBoundary: {
      parentPlanned: Boolean(parentMutation),
      childPlanned: Boolean(childMutation),
      childChangeKind: childMutation?.changeKind || null,
      childPostParent: Number(childValue?.post_parent),
      childCarriesParent: Number(childValue?.post_parent) === parentId,
      childMutationHash: childMutation ? digest({
        resourceKey: childMutation.resourceKey,
        action: childMutation.action,
        changeKind: childMutation.changeKind,
        baseHash: childMutation.baseHash,
        remoteBeforeHash: childMutation.remoteBeforeHash,
        localHash: childMutation.localHash,
        postParent: Number(childValue?.post_parent),
      }) : null,
    },
    preconditions: {
      parentLiveRemote: parentPreconditionLive,
      childLiveRemote: childPreconditionLive,
      parentExpectedHash: parentPrecondition?.expectedHash || null,
      childExpectedHash: childPrecondition?.expectedHash || null,
    },
    applyRevalidation: {
      required: applyRevalidation.required || null,
      phase: applyRevalidation.phase || null,
      checkedAgainst: applyRevalidation.checkedAgainst || null,
      verifiedCount: applyRevalidation.verifiedCount ?? null,
      verifiedResourceKeysHash: digest(verifiedResourceKeys),
      coversParent: verifiedResourceKeys.includes(parentResourceKey),
      coversChild: verifiedResourceKeys.includes(childResourceKey),
      exactMutationSet: JSON.stringify(verifiedResourceKeys) === JSON.stringify(mutationResourceKeys),
      planHashMatches: applyRevalidation.planHash === digest(plan),
      receiptHashMatches: applyRevalidation.receiptHash === proof?.dryRun?.receiptHash,
    },
    after: {
      finalMatchesLocal: proof?.after?.finalMatchesLocal === true,
      appliedChildPostParent: Number(appliedSite?.db?.wp_posts?.[childRowId]?.post_parent),
      appliedCarriesParent: Number(appliedSite?.db?.wp_posts?.[childRowId]?.post_parent) === parentId,
    },
  };

  const invariants = {
    readyPlan: evidence.plan.status === 'ready',
    noGraphBlockers: evidence.plan.blockerCount === 0,
    parentMutationPlanned: evidence.mutationBoundary.parentPlanned,
    childMutationPlanned: evidence.mutationBoundary.childPlanned,
    childCarriesParent: evidence.mutationBoundary.childCarriesParent,
    parentHasLiveRemotePrecondition: evidence.preconditions.parentLiveRemote,
    childHasLiveRemotePrecondition: evidence.preconditions.childLiveRemote,
    applyRevalidatesBeforeFirstMutation:
      evidence.applyRevalidation.required === 'fresh-live-hashes-before-first-mutation'
      && evidence.applyRevalidation.phase === 'before-first-mutation'
      && evidence.applyRevalidation.checkedAgainst === 'live-remote',
    applyRevalidationCoversPostParentResources:
      evidence.applyRevalidation.coversParent && evidence.applyRevalidation.coversChild,
    applyRevalidationBindsExactMutationSet:
      evidence.applyRevalidation.verifiedCount === evidence.plan.mutationCount
      && evidence.applyRevalidation.exactMutationSet
      && evidence.applyRevalidation.planHashMatches
      && evidence.applyRevalidation.receiptHashMatches,
    releaseVerifierAfterMatchesLocal: evidence.after.finalMatchesLocal,
    appliedCarriesParent: evidence.after.appliedCarriesParent,
    receiptHashPresent: hashPattern.test(proof?.dryRun?.receiptHash || ''),
  };

  return {
    ...evidence,
    status: Object.values(invariants).every(Boolean) ? 'checked' : 'blocked',
    verdict: Object.values(invariants).every(Boolean)
      ? 'POST_PARENT_PAGE_HIERARCHY_RELEASE_VERIFIER_CARRIED'
      : 'POST_PARENT_PAGE_HIERARCHY_RELEASE_VERIFIER_REQUIRED',
    invariants,
    evidenceHash: digest({ evidence, invariants }),
  };
}

test('RPP-0381 carries same-plan post_parent page hierarchy through the release verifier proof shape', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_posts[parentRowId] = pageRow({
    id: parentId,
    title: 'RPP-0381 Local Private Parent Page',
    slug: 'rpp-0381-private-parent',
    content: 'RPP-0381 private parent body',
  });
  local.db.wp_posts[childRowId] = pageRow({
    id: childId,
    title: 'RPP-0381 Local Private Child Page',
    slug: 'rpp-0381-private-child',
    content: 'RPP-0381 private child body',
    parent: parentId,
  });

  const plan = planFor(base, local, remote);
  const applied = applyPlan(cloneJson(remote), plan).site;
  const proof = releaseVerifierProofFor({ plan, appliedSite: applied, localSite: local });
  const evidence = summarizePostParentReleaseVerifierEvidence({ proof, appliedSite: applied });
  const childMutation = mutationFor(plan, childResourceKey);
  const parentMutation = mutationFor(plan, parentResourceKey);
  const childValue = deserializeResourceValue(childMutation.value);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(parentMutation.changeKind, 'create');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(childValue.post_parent, parentId);
  assert.deepEqual(
    proof.apply.applyRevalidation.verifiedResourceKeys,
    plan.mutations.map((mutation) => mutation.resourceKey),
  );
  assert.equal(proof.apply.applyRevalidation.verifiedCount, plan.mutations.length);
  assert.equal(proof.after.finalMatchesLocal, true);
  assert.equal(applied.db.wp_posts[childRowId].post_parent, parentId);

  assert.equal(evidence.status, 'checked');
  assert.equal(evidence.verdict, 'POST_PARENT_PAGE_HIERARCHY_RELEASE_VERIFIER_CARRIED');
  assert.equal(evidence.mutationBoundary.childCarriesParent, true);
  assert.equal(evidence.preconditions.parentLiveRemote, true);
  assert.equal(evidence.preconditions.childLiveRemote, true);
  assert.equal(evidence.applyRevalidation.coversParent, true);
  assert.equal(evidence.applyRevalidation.coversChild, true);
  assert.equal(evidence.applyRevalidation.exactMutationSet, true);
  assert.equal(evidence.after.appliedCarriesParent, true);
  assert.match(evidence.evidenceHash, hashPattern);

  const evidenceJson = JSON.stringify(evidence);
  for (const privateValue of [
    'RPP-0381 Local Private Parent Page',
    'RPP-0381 Local Private Child Page',
    'RPP-0381 private parent body',
    'RPP-0381 private child body',
  ]) {
    assert.equal(evidenceJson.includes(privateValue), false, `release evidence leaked ${privateValue}`);
  }
});

test('RPP-0381 fails closed before mutation when a post_parent target page drifts remotely', () => {
  const base = baseSite();
  base.db.wp_posts[parentRowId] = pageRow({
    id: parentId,
    title: 'RPP-0381 Base Private Parent Page',
    slug: 'rpp-0381-base-parent',
    content: 'RPP-0381 base private parent body',
  });
  const local = cloneJson(base);
  local.db.wp_posts[childRowId] = pageRow({
    id: childId,
    title: 'RPP-0381 Local Private Child Page',
    slug: 'rpp-0381-stale-child',
    content: 'RPP-0381 stale private child body',
    parent: parentId,
  });
  const remote = cloneJson(base);
  remote.db.wp_posts[parentRowId].post_title = 'RPP-0381 Remote Private Parent Drift';
  remote.db.wp_posts[parentRowId].post_content = 'RPP-0381 remote private parent body drift';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === childResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'post-parent');
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, childResourceKey), null);
  assert.ok(blocker, 'missing post_parent graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.ok(reference, 'missing post_parent target reference evidence');
  assert.equal(reference.relationshipKey, 'wp_posts.post_parent');
  assert.equal(reference.sourceResourceKey, childResourceKey);
  assert.equal(reference.targetResourceKey, parentResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.match(reference.targetBaseHash, hashPattern);
  assert.match(reference.targetRemoteHash, hashPattern);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked release path must refuse before mutation');

  const blockerJson = JSON.stringify(blocker);
  for (const privateValue of [
    'RPP-0381 Base Private Parent Page',
    'RPP-0381 Local Private Child Page',
    'RPP-0381 Remote Private Parent Drift',
    'RPP-0381 remote private parent body drift',
  ]) {
    assert.equal(blockerJson.includes(privateValue), false, `blocker leaked ${privateValue}`);
  }
});

test('RPP-0381 production-shaped release verifier contract revalidates every planned resource before apply', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.phase, 'before-first-mutation'/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.checkedAgainst, 'live-remote'/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.planHash, digest\(proof\.planObject\)/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.verifiedCount, proof\.planObject\.mutations\.length/);
  assert.match(
    verifierSource,
    /proof\.apply\.applyRevalidation\?\.verifiedResourceKeys,[\s\S]*proof\.planObject\.mutations\.map\(\(mutation\) => mutation\.resourceKey\)/,
  );
  assert.match(verifierSource, /proof\.after\.finalMatchesLocal, true/);
});
