import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0356-wp-navigation-fail-closed-reference-v3.md',
);

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const sourceNavigationId = 356;
const targetNavigationId = 1356;
const sourceNavigationRowId = `ID:${sourceNavigationId}`;
const targetNavigationRowId = `ID:${targetNavigationId}`;
const navigationMetaKey = 'rpp0356_navigation_owner';
const sourceNavigationMetaRowId = `post_id:${sourceNavigationId}:meta_key:${navigationMetaKey}`;
const rewrittenNavigationMetaRowId = `post_id:${targetNavigationId}:meta_key:${navigationMetaKey}`;

const sourceNavigationResourceKey = rowResourceKey('wp_posts', sourceNavigationRowId);
const targetNavigationResourceKey = rowResourceKey('wp_posts', targetNavigationRowId);
const sourceNavigationMetaResourceKey = rowResourceKey('wp_postmeta', sourceNavigationMetaRowId);
const rewrittenNavigationMetaResourceKey = rowResourceKey('wp_postmeta', rewrittenNavigationMetaRowId);

const privateNavigationFixtures = Object.freeze([
  'RPP-0356 Local Private Navigation',
  'rpp-0356-local-private-navigation',
  'RPP-0356 private navigation block label',
  'rpp-0356-local-private-navigation-guid',
  'rpp-0356-private-navigation-meta',
  'RPP-0356 Mapped Private Navigation',
  'rpp-0356-mapped-private-navigation',
  'RPP-0356 mapped private navigation block label',
  'rpp-0356-mapped-private-navigation-meta',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0356 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0356 stable anchor post',
          post_name: 'rpp-0356-stable-anchor',
          post_content: 'RPP-0356 stable anchor body',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
    },
  };
}

function navigationRow({ id, title, slug, label, guid = undefined }) {
  return {
    ID: id,
    post_title: title,
    post_name: slug,
    post_content: `<!-- wp:navigation-link {"label":${JSON.stringify(label)},"url":"/rpp-0356"} /-->`,
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
    ...(guid ? { guid } : {}),
  };
}

function addLocalNavigationSource(snapshot, { withIdentityMap = false } = {}) {
  if (withIdentityMap) {
    snapshot.meta = {
      wordpressGraphIdentityMap: {
        rows: [
          {
            table: 'wp_posts',
            localId: sourceNavigationRowId,
            remoteId: targetNavigationRowId,
          },
        ],
      },
    };
  }

  snapshot.db.wp_posts[sourceNavigationRowId] = navigationRow({
    id: sourceNavigationId,
    title: withIdentityMap ? 'RPP-0356 Mapped Private Navigation' : 'RPP-0356 Local Private Navigation',
    slug: withIdentityMap ? 'rpp-0356-mapped-private-navigation' : 'rpp-0356-local-private-navigation',
    label: withIdentityMap
      ? 'RPP-0356 mapped private navigation block label'
      : 'RPP-0356 private navigation block label',
    guid: withIdentityMap ? undefined : 'rpp-0356-local-private-navigation-guid',
  });
  snapshot.db.wp_postmeta[sourceNavigationMetaRowId] = {
    post_id: sourceNavigationId,
    meta_key: navigationMetaKey,
    meta_value: withIdentityMap
      ? 'rpp-0356-mapped-private-navigation-meta'
      : 'rpp-0356-private-navigation-meta',
  };
}

function addRemoteNavigationTarget(snapshot) {
  snapshot.db.wp_posts[targetNavigationRowId] = navigationRow({
    id: targetNavigationId,
    title: 'RPP-0356 Mapped Private Navigation',
    slug: 'rpp-0356-mapped-private-navigation',
    label: 'RPP-0356 mapped private navigation block label',
  });
}

function navigationSnapshots({ withIdentityMap = false, withRemoteTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  addLocalNavigationSource(local, { withIdentityMap });
  if (withRemoteTarget) {
    addRemoteNavigationTarget(remote);
  }

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
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

function isSha256Hex(value) {
  return typeof value === 'string' && hashPattern.test(value);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function hasHashOnlyChangeEvidence(entry) {
  return Boolean(entry)
    && [
      entry.baseHash,
      entry.localHash,
      entry.remoteHash,
      entry.change?.base?.hash,
      entry.change?.local?.hash,
      entry.change?.remote?.hash,
    ].every(isSha256Hex)
    && ['base', 'local', 'remote'].every((state) =>
      Object.hasOwn(entry.change?.[state] || {}, 'value') === false);
}

function hasHashOnlyTargetReference(reference) {
  return Boolean(reference)
    && [
      reference.targetBaseHash,
      reference.targetLocalHash,
      reference.targetRemoteHash,
      reference.targetChange?.base?.hash,
      reference.targetChange?.local?.hash,
      reference.targetChange?.remote?.hash,
    ].every(isSha256Hex)
    && ['base', 'local', 'remote'].every((state) =>
      Object.hasOwn(reference.targetChange?.[state] || {}, 'value') === false);
}

function summarizePlan(plan) {
  return {
    status: plan.status,
    summary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
      atomicGroups: plan.summary.atomicGroups,
    },
    mutationCount: plan.mutations.length,
    decisionCount: plan.decisions.length,
    blockerCount: plan.blockers.length,
    preconditionCount: plan.preconditions.length,
    hash: sha256Evidence({
      status: plan.status,
      summary: plan.summary,
      mutations: plan.mutations.map((mutation) => ({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })),
      decisions: plan.decisions.map((decision) => ({
        resourceKey: decision.resourceKey,
        decision: decision.decision,
        targetResourceKey: decision.targetResourceKey || null,
        baseHash: decision.baseHash || null,
        localHash: decision.localHash || null,
        remoteHash: decision.remoteHash || null,
      })),
      blockers: plan.blockers.map((blocker) => ({
        resourceKey: blocker.resourceKey,
        class: blocker.class,
        reasonHash: digest(blocker.reason || ''),
        baseHash: blocker.baseHash,
        localHash: blocker.localHash,
        remoteHash: blocker.remoteHash,
      })),
    }),
  };
}

function changeHashEvidence(change) {
  return {
    localChange: change?.localChange || null,
    remoteChange: change?.remoteChange || null,
    base: {
      state: change?.base?.state || null,
      hash: change?.base?.hash || null,
    },
    local: {
      state: change?.local?.state || null,
      hash: change?.local?.hash || null,
    },
    remote: {
      state: change?.remote?.state || null,
      hash: change?.remote?.hash || null,
    },
  };
}

function hashOnlyReferenceEvidence(reference) {
  return reference ? {
    relationshipKey: reference.relationshipKey || null,
    relationshipType: reference.relationshipType || null,
    sourceResourceKey: reference.sourceResourceKey || null,
    targetResourceKey: reference.targetResourceKey || null,
    targetTable: reference.targetTable || null,
    targetId: reference.targetId || null,
    targetBaseHash: reference.targetBaseHash || null,
    targetLocalHash: reference.targetLocalHash || null,
    targetRemoteHash: reference.targetRemoteHash || null,
    targetChange: changeHashEvidence(reference.targetChange),
    targetSupport: reference.targetSupport ? {
      supported: reference.targetSupport.supported === true,
      className: reference.targetSupport.className || null,
      reasonHash: digest(reference.targetSupport.reason || ''),
    } : null,
  } : null;
}

function hashOnlyBlockerEvidence(blocker) {
  return blocker ? {
    id: blocker.id,
    class: blocker.class,
    resourceKey: blocker.resourceKey,
    resolutionPolicy: blocker.resolutionPolicy || null,
    reasonHash: digest(blocker.reason || ''),
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
    change: changeHashEvidence(blocker.change),
    references: (blocker.references || []).map(hashOnlyReferenceEvidence),
  } : null;
}

function decisionEvidence(decision) {
  return decision ? {
    resourceKey: decision.resourceKey,
    decision: decision.decision,
    targetResourceKey: decision.targetResourceKey || null,
    identityMapSource: decision.identityMapSource || null,
    baseHash: decision.baseHash || null,
    localHash: decision.localHash || null,
    remoteHash: decision.remoteHash || null,
    targetRemoteHash: decision.targetRemoteHash || null,
  } : null;
}

function rewriteEvidence(rewrite) {
  return rewrite ? {
    relationshipKey: rewrite.relationshipKey || null,
    relationshipType: rewrite.relationshipType || null,
    field: rewrite.field || null,
    sourceResourceKey: rewrite.sourceResourceKey || null,
    sourceTargetResourceKey: rewrite.sourceTargetResourceKey || null,
    targetResourceKey: rewrite.targetResourceKey || null,
    rewrittenResourceKey: rewrite.rewrittenResourceKey || null,
    identityMapSource: rewrite.identityMapSource || null,
    sourceTargetLocalHash: rewrite.sourceTargetLocalHash || null,
    targetRemoteHash: rewrite.targetRemoteHash || null,
  } : null;
}

function buildFailClosedSupportEvidence() {
  const fixture = navigationSnapshots();
  const plan = planFor(fixture);
  const navigationBlocker = blockerFor(plan, sourceNavigationResourceKey);
  const metaBlocker = blockerFor(plan, sourceNavigationMetaResourceKey);
  const postReference = metaBlocker?.references.find((reference) =>
    reference.relationshipType === 'postmeta-post') || null;
  const remoteAttempt = cloneJson(fixture.remote);
  const remoteHashBefore = sha256Evidence(remoteAttempt);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteAttempt, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteHashAfter = sha256Evidence(remoteAttempt);

  const invariants = {
    planBlocked: plan.status === 'blocked',
    navigationMutationAbsent: !mutationFor(plan, sourceNavigationResourceKey),
    navigationMetaMutationAbsent: !mutationFor(plan, sourceNavigationMetaResourceKey),
    unsupportedNavigationSurfaceRejected: navigationBlocker?.class === 'stale-wordpress-graph-identity'
      && navigationBlocker?.resolutionPolicy === 'preserve-remote-wordpress-graph-and-stop'
      && /unsupported post graph surface wp_navigation/.test(navigationBlocker.reason || ''),
    postmetaTargetRejected: postReference?.relationshipKey === 'wp_postmeta.post_id'
      && postReference?.targetResourceKey === sourceNavigationResourceKey
      && postReference?.targetSupport?.className === 'stale-wordpress-graph-identity',
    applyRefusedBeforeMutation: error instanceof PushPlanError
      && error.code === 'PLAN_NOT_READY'
      && beforeMutationCalls === 0,
    remoteDataPreserved: remoteHashAfter === remoteHashBefore,
    hashOnlyEvidence: hasHashOnlyChangeEvidence(navigationBlocker)
      && hasHashOnlyChangeEvidence(metaBlocker)
      && hasHashOnlyTargetReference(postReference),
  };
  const evidence = {
    rpp: 'RPP-0356',
    evidenceSource: 'wp-navigation-fail-closed-reference-v3',
    evidenceScope: 'local-generated-support',
    status: 'support_only',
    releaseGate: 'NO-GO',
    productionBacked: false,
    scenario: 'unmapped-wp-navigation-postmeta-target',
    relationship: {
      relationshipKey: 'wp_postmeta.post_id',
      relationshipType: 'postmeta-post',
      navigationResourceKey: sourceNavigationResourceKey,
      navigationMetaResourceKey: sourceNavigationMetaResourceKey,
    },
    plan: summarizePlan(plan),
    graphIdentity: {
      navigationBlocker: hashOnlyBlockerEvidence(navigationBlocker),
      metaBlocker: hashOnlyBlockerEvidence(metaBlocker),
    },
    applyRefusal: {
      code: error.code,
      beforeMutationCalls,
      remoteHashBefore,
      remoteHashAfter,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: privateNavigationFixtures.length,
    },
    invariants,
    ok: Object.values(invariants).every(Boolean),
  };

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function buildMappedRewriteSupportEvidence() {
  const fixture = navigationSnapshots({
    withIdentityMap: true,
    withRemoteTarget: true,
  });
  const plan = planFor(fixture);
  const sourceDecision = decisionFor(plan, sourceNavigationResourceKey);
  const targetDecision = decisionFor(plan, targetNavigationResourceKey);
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);
  const rewrittenMetaPrecondition = preconditionFor(plan, rewrittenNavigationMetaResourceKey);
  const plannedMeta = rewrittenMetaMutation
    ? deserializeResourceValue(rewrittenMetaMutation.value)
    : null;
  const postRewrite = rewrittenMetaMutation?.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post') || null;
  let beforeMutationCalls = 0;
  const applied = applyPlan(cloneJson(fixture.remote), plan, {
    beforeMutation({ mutation }) {
      if (mutation.resourceKey === rewrittenNavigationMetaResourceKey) {
        beforeMutationCalls += 1;
      }
    },
  });
  const finalMeta = applied.site.db.wp_postmeta[rewrittenNavigationMetaRowId] || null;

  const invariants = {
    planReady: plan.status === 'ready',
    noGraphIdentityBlockers: plan.blockers.length === 0,
    sourceNavigationMappedToRemote: sourceDecision?.decision === 'map-local-identity-to-remote'
      && sourceDecision?.targetResourceKey === targetNavigationResourceKey,
    targetNavigationPreserved: targetDecision?.decision === 'keep-remote',
    sourceRowsNotMutated: ![
      sourceNavigationResourceKey,
      targetNavigationResourceKey,
      sourceNavigationMetaResourceKey,
    ].some((resourceKey) => mutationFor(plan, resourceKey)),
    metadataRewrittenToRemoteTarget: rewrittenMetaMutation?.resourceKey === rewrittenNavigationMetaResourceKey
      && rewrittenMetaMutation?.changeKind === 'create'
      && plannedMeta?.post_id === targetNavigationId
      && postRewrite?.relationshipKey === 'wp_postmeta.post_id'
      && postRewrite?.sourceTargetResourceKey === sourceNavigationResourceKey
      && postRewrite?.targetResourceKey === targetNavigationResourceKey
      && postRewrite?.rewrittenResourceKey === rewrittenNavigationMetaResourceKey,
    rewrittenMetadataHasLivePrecondition: rewrittenMetaPrecondition?.checkedAgainst === 'live-remote'
      && rewrittenMetaPrecondition?.expectedHash === rewrittenMetaMutation?.remoteBeforeHash
      && isSha256Hex(rewrittenMetaPrecondition?.expectedHash),
    applyCarriedRemoteNavigationId: applied.appliedMutations === 1
      && beforeMutationCalls === 1
      && finalMeta?.post_id === targetNavigationId
      && applied.site.db.wp_posts[targetNavigationRowId]?.post_type === 'wp_navigation'
      && !applied.site.db.wp_posts[sourceNavigationRowId]
      && !applied.site.db.wp_postmeta[sourceNavigationMetaRowId],
    hashOnlyRewriteEvidence: isSha256Hex(postRewrite?.sourceTargetLocalHash)
      && isSha256Hex(postRewrite?.targetRemoteHash),
  };
  const evidence = {
    rpp: 'RPP-0356',
    evidenceSource: 'wp-navigation-fail-closed-reference-v3',
    evidenceScope: 'local-generated-support',
    status: 'support_only',
    releaseGate: 'NO-GO',
    productionBacked: false,
    scenario: 'wp-navigation-identity-map-rewrites-postmeta-reference',
    relationship: {
      relationshipKey: 'wp_postmeta.post_id',
      relationshipType: 'postmeta-post',
      sourceNavigationResourceKey,
      targetNavigationResourceKey,
      sourceNavigationMetaResourceKey,
      rewrittenNavigationMetaResourceKey,
    },
    plan: summarizePlan(plan),
    identityMap: {
      sourceNavigation: decisionEvidence(sourceDecision),
      targetNavigation: decisionEvidence(targetDecision),
    },
    rewrite: rewriteEvidence(postRewrite),
    mutation: rewrittenMetaMutation ? {
      resourceKey: rewrittenMetaMutation.resourceKey,
      action: rewrittenMetaMutation.action,
      changeKind: rewrittenMetaMutation.changeKind,
      postId: plannedMeta?.post_id ?? null,
      baseHash: rewrittenMetaMutation.baseHash,
      localHash: rewrittenMetaMutation.localHash,
      remoteBeforeHash: rewrittenMetaMutation.remoteBeforeHash,
      precondition: rewrittenMetaPrecondition ? {
        checkedAgainst: rewrittenMetaPrecondition.checkedAgainst,
        expectedHash: rewrittenMetaPrecondition.expectedHash,
        matchesRemoteBeforeHash: rewrittenMetaPrecondition.expectedHash === rewrittenMetaMutation.remoteBeforeHash,
      } : null,
    } : null,
    applyCarryThrough: {
      appliedMutations: applied.appliedMutations,
      beforeMutationCalls,
      finalMetadataResourceKey: rewrittenNavigationMetaResourceKey,
      finalMetadataPostId: finalMeta?.post_id ?? null,
      sourceNavigationAbsent: !applied.site.db.wp_posts[sourceNavigationRowId],
      sourceMetadataAbsent: !applied.site.db.wp_postmeta[sourceNavigationMetaRowId],
      targetNavigationHash: sha256Evidence(applied.site.db.wp_posts[targetNavigationRowId]),
    },
    redaction: {
      format: 'hash-only-plus-resource-ids',
      rawValuesIncluded: false,
      checkedFixtureCount: privateNavigationFixtures.length,
    },
    invariants,
    ok: Object.values(invariants).every(Boolean),
  };

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length, 'expected one precondition per mutation');

  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation.resourceKey);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function assertNoPrivateNavigationFixtures(value, label) {
  const serialized = JSON.stringify(value);

  for (const fixture of privateNavigationFixtures) {
    assert.equal(serialized.includes(fixture), false, `${label} leaked ${fixture}`);
  }
  for (const rawField of ['post_title', 'post_name', 'post_content', 'guid', 'meta_value']) {
    assert.equal(serialized.includes(rawField), false, `${label} exposed raw ${rawField} field`);
  }

  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0356 generated support keeps wp_navigation references fail-closed with hash-only evidence', () => {
  const proof = buildFailClosedSupportEvidence();

  assert.equal(proof.rpp, 'RPP-0356');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.productionBacked, false);
  assert.deepEqual(proof.plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.equal(proof.graphIdentity.navigationBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(proof.graphIdentity.navigationBlocker.resourceKey, sourceNavigationResourceKey);
  assert.equal(proof.graphIdentity.navigationBlocker.references.length, 0);
  assert.equal(proof.graphIdentity.metaBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(proof.graphIdentity.metaBlocker.resourceKey, sourceNavigationMetaResourceKey);
  assert.equal(proof.graphIdentity.metaBlocker.references[0].relationshipKey, 'wp_postmeta.post_id');
  assert.equal(proof.graphIdentity.metaBlocker.references[0].relationshipType, 'postmeta-post');
  assert.equal(proof.graphIdentity.metaBlocker.references[0].targetResourceKey, sourceNavigationResourceKey);
  assert.equal(
    proof.graphIdentity.metaBlocker.references[0].targetSupport.className,
    'stale-wordpress-graph-identity',
  );
  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.deepEqual(proof.invariants, {
    planBlocked: true,
    navigationMutationAbsent: true,
    navigationMetaMutationAbsent: true,
    unsupportedNavigationSurfaceRejected: true,
    postmetaTargetRejected: true,
    applyRefusedBeforeMutation: true,
    remoteDataPreserved: true,
    hashOnlyEvidence: true,
  });
  assert.equal(proof.ok, true);
  assertSha256Evidence(proof.proofHash, 'RPP-0356 fail-closed proof hash');
  assertNoPrivateNavigationFixtures(proof, 'RPP-0356 fail-closed support evidence');
});

test('RPP-0356 generated support rewrites wp_navigation postmeta when target identity is proven', () => {
  const fixture = navigationSnapshots({
    withIdentityMap: true,
    withRemoteTarget: true,
  });
  const plan = planFor(fixture);
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);
  const plannedMeta = deserializeResourceValue(rewrittenMetaMutation.value);
  const postRewrite = rewrittenMetaMutation.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post');
  const result = applyPlan(cloneJson(fixture.remote), plan);
  const proof = buildMappedRewriteSupportEvidence();

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutationFor(plan, sourceNavigationResourceKey), null);
  assert.equal(mutationFor(plan, targetNavigationResourceKey), null);
  assert.equal(mutationFor(plan, sourceNavigationMetaResourceKey), null);
  assert.equal(decisionFor(plan, sourceNavigationResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, sourceNavigationResourceKey).targetResourceKey, targetNavigationResourceKey);
  assert.equal(decisionFor(plan, targetNavigationResourceKey).decision, 'keep-remote');
  assert.ok(rewrittenMetaMutation, 'missing rewritten wp_navigation metadata mutation');
  assert.deepEqual(plannedMeta, {
    post_id: targetNavigationId,
    meta_key: navigationMetaKey,
    meta_value: 'rpp-0356-mapped-private-navigation-meta',
  });
  assert.equal(postRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postRewrite.sourceResourceKey, sourceNavigationMetaResourceKey);
  assert.equal(postRewrite.sourceTargetResourceKey, sourceNavigationResourceKey);
  assert.equal(postRewrite.targetResourceKey, targetNavigationResourceKey);
  assert.equal(postRewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(postRewrite.identityMapSource, 'local-snapshot.meta.identityMap[0].rows[0]');
  assert.match(postRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postRewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_posts[sourceNavigationRowId], undefined);
  assert.equal(result.site.db.wp_posts[targetNavigationRowId].post_type, 'wp_navigation');
  assert.equal(result.site.db.wp_postmeta[sourceNavigationMetaRowId], undefined);
  assert.deepEqual(result.site.db.wp_postmeta[rewrittenNavigationMetaRowId], {
    post_id: targetNavigationId,
    meta_key: navigationMetaKey,
    meta_value: 'rpp-0356-mapped-private-navigation-meta',
  });

  assert.equal(proof.status, 'support_only');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.identityMap.sourceNavigation.decision, 'map-local-identity-to-remote');
  assert.equal(proof.identityMap.targetNavigation.decision, 'keep-remote');
  assert.equal(proof.rewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(proof.rewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(proof.mutation.resourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(proof.mutation.postId, targetNavigationId);
  assert.equal(proof.mutation.precondition.matchesRemoteBeforeHash, true);
  assert.deepEqual(proof.invariants, {
    planReady: true,
    noGraphIdentityBlockers: true,
    sourceNavigationMappedToRemote: true,
    targetNavigationPreserved: true,
    sourceRowsNotMutated: true,
    metadataRewrittenToRemoteTarget: true,
    rewrittenMetadataHasLivePrecondition: true,
    applyCarriedRemoteNavigationId: true,
    hashOnlyRewriteEvidence: true,
  });
  assert.equal(proof.ok, true);
  assertSha256Evidence(proof.proofHash, 'RPP-0356 mapped rewrite proof hash');
  assertNoPrivateNavigationFixtures(proof, 'RPP-0356 mapped rewrite support evidence');
});

test('RPP-0356 evidence document labels support-only NO-GO release posture', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0356 wp_navigation fail-closed reference v3 evidence$/m);
  assert.match(evidenceDoc, /support-only/i);
  assert.match(evidenceDoc, /Final release posture: `NO-GO`/);
  assert.match(evidenceDoc, /hash-only/i);
});
