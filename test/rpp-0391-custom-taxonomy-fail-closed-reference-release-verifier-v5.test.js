import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:39:10.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const postId = 391001;
const sourceTermId = 39144;
const sourceTermTaxonomyId = 39154;
const targetTermId = 391144;
const targetTermTaxonomyId = 391154;
const taxonomy = 'product_cat';

const sourceTermResourceKey = rowResourceKey('wp_terms', `term_id:${sourceTermId}`);
const sourceTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${sourceTermTaxonomyId}`);
const sourceRelationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${sourceTermTaxonomyId}`,
);
const targetTermResourceKey = rowResourceKey('wp_terms', `term_id:${targetTermId}`);
const targetTaxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${targetTermTaxonomyId}`);
const rewrittenRelationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${targetTermTaxonomyId}`,
);

const privateCustomTaxonomyFixtures = Object.freeze([
  'RPP-0391 Private Product Category',
  'rpp-0391-private-product-category',
  'RPP-0391 private custom taxonomy description',
  'RPP-0391 remote private custom taxonomy drift description',
]);

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0391-base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: 'RPP-0391 stable post object',
          post_name: 'rpp-0391-stable-post-object',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
    },
  };
}

function addLocalCustomTaxonomySource(snapshot, { withIdentityMap = false } = {}) {
  if (withIdentityMap) {
    snapshot.meta = {
      wordpressGraphIdentityMap: {
        rows: [
          { table: 'wp_terms', localId: `term_id:${sourceTermId}`, remoteId: `term_id:${targetTermId}` },
          {
            table: 'wp_term_taxonomy',
            localId: `term_taxonomy_id:${sourceTermTaxonomyId}`,
            remoteId: `term_taxonomy_id:${targetTermTaxonomyId}`,
          },
        ],
      },
    };
  }

  snapshot.db.wp_terms[`term_id:${sourceTermId}`] = {
    term_id: sourceTermId,
    name: 'RPP-0391 Private Product Category',
    slug: 'rpp-0391-private-product-category',
    term_group: 0,
  };
  snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTermTaxonomyId}`] = {
    term_taxonomy_id: sourceTermTaxonomyId,
    term_id: sourceTermId,
    taxonomy,
    description: 'RPP-0391 private custom taxonomy description',
    parent: 0,
    count: 1,
  };
  snapshot.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${sourceTermTaxonomyId}`] = {
    object_id: postId,
    term_taxonomy_id: sourceTermTaxonomyId,
    term_order: 0,
  };
}

function addRemoteCustomTaxonomyTarget(snapshot, { drift = false } = {}) {
  snapshot.db.wp_terms[`term_id:${targetTermId}`] = {
    term_id: targetTermId,
    name: 'RPP-0391 Private Product Category',
    slug: 'rpp-0391-private-product-category',
    term_group: 0,
  };
  snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${targetTermTaxonomyId}`] = {
    term_taxonomy_id: targetTermTaxonomyId,
    term_id: targetTermId,
    taxonomy,
    description: drift
      ? 'RPP-0391 remote private custom taxonomy drift description'
      : 'RPP-0391 private custom taxonomy description',
    parent: 0,
    count: 1,
  };
}

function customTaxonomySnapshots({ withIdentityMap = false, withRemoteTarget = false, remoteTargetDrift = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  addLocalCustomTaxonomySource(local, { withIdentityMap });
  if (withRemoteTarget) {
    addRemoteCustomTaxonomyTarget(remote, { drift: remoteTargetDrift });
  }

  return { base, local, remote };
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

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function summarizePlan(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutationCount: plan.mutations.length,
    decisionCount: plan.decisions.length,
    preconditionCount: plan.preconditions.length,
    conflictCount: plan.conflicts.length,
    blockerCount: plan.blockers.length,
    hash: sha256Evidence(plan),
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

function hashOnlyBlockerEvidence(blocker) {
  return {
    id: blocker?.id || null,
    class: blocker?.class || null,
    resourceKey: blocker?.resourceKey || null,
    reasonHash: digest(blocker?.reason || ''),
    resolutionPolicy: blocker?.resolutionPolicy || null,
    baseHash: blocker?.baseHash || null,
    localHash: blocker?.localHash || null,
    remoteHash: blocker?.remoteHash || null,
    change: changeHashEvidence(blocker?.change),
    references: (blocker?.references || []).map((reference) => ({
      relationshipKey: reference.relationshipKey || null,
      relationshipType: reference.relationshipType || null,
      sourceResourceKey: reference.sourceResourceKey || null,
      sourceTable: reference.sourceTable || null,
      sourceRowId: reference.sourceRowId || null,
      targetResourceKey: reference.targetResourceKey || null,
      targetTable: reference.targetTable || null,
      targetId: reference.targetId || null,
      targetBaseHash: reference.targetBaseHash || null,
      targetLocalHash: reference.targetLocalHash || null,
      targetRemoteHash: reference.targetRemoteHash || null,
      targetChange: changeHashEvidence(reference.targetChange),
      targetSupport: reference.targetSupport ? {
        supported: reference.targetSupport.supported,
        className: reference.targetSupport.className || null,
        reasonHash: digest(reference.targetSupport.reason || ''),
      } : null,
    })),
  };
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
    rewrittenResourceKey: rewrite.rewrittenResourceKey || null,
    sourceTargetResourceKey: rewrite.sourceTargetResourceKey || null,
    targetResourceKey: rewrite.targetResourceKey || null,
    identityMapSource: rewrite.identityMapSource || null,
    sourceTargetLocalHash: rewrite.sourceTargetLocalHash || null,
    targetRemoteHash: rewrite.targetRemoteHash || null,
  } : null;
}

function releaseVerifierProof(plan, { verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey) } = {}) {
  return {
    planObject: plan,
    apply: {
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        verifiedResourceKeys,
        verifiedCount: verifiedResourceKeys.length,
        planHash: digest(plan),
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations),
      },
    },
  };
}

function releaseVerifierScope(overrides = {}) {
  return {
    rpp: 'RPP-0391',
    evidenceSource: 'release-verifier-custom-taxonomy-fail-closed-reference-v5',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseGate: 'NO-GO',
    noGoCaveat: 'Local release-verifier evidence only; production-backed release evidence is still required.',
    taxonomy,
    ...overrides,
  };
}

function buildFailClosedReleaseVerifierEvidence() {
  const { base, local, remote } = customTaxonomySnapshots();
  const plan = planFor(base, local, remote);
  const taxonomyBlocker = plan.blockers.find((blocker) => blocker.resourceKey === sourceTaxonomyResourceKey) || null;
  const relationshipBlocker = plan.blockers.find((blocker) =>
    blocker.resourceKey === sourceRelationshipResourceKey) || null;
  const relationshipReference = relationshipBlocker?.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy') || null;
  const remoteAttempt = cloneJson(remote);
  const remoteHashBefore = sha256Evidence(remoteAttempt);
  const error = captureError(() => applyPlan(remoteAttempt, plan));
  const remoteHashAfter = sha256Evidence(remoteAttempt);
  const invariants = {
    blockedPlan: plan.status === 'blocked',
    taxonomyMutationAbsent: !mutationFor(plan, sourceTaxonomyResourceKey),
    relationshipMutationAbsent: !mutationFor(plan, sourceRelationshipResourceKey),
    standaloneTermMutationPlannedButNotApplied: Boolean(mutationFor(plan, sourceTermResourceKey)),
    customTaxonomySurfaceRejected: taxonomyBlocker?.class === 'stale-wordpress-graph-identity'
      && taxonomyBlocker?.resolutionPolicy === 'preserve-remote-wordpress-graph-and-stop'
      && /unsupported taxonomy graph surface product_cat/.test(taxonomyBlocker?.reason || ''),
    relationshipTargetRejected: relationshipReference?.relationshipKey === 'wp_term_relationships.term_taxonomy_id'
      && relationshipReference?.targetResourceKey === sourceTaxonomyResourceKey
      && relationshipReference?.targetSupport?.className === 'stale-wordpress-graph-identity',
    applyRefusedBeforeMutation: error instanceof PushPlanError
      && error.code === 'PLAN_NOT_READY'
      && remoteHashAfter === remoteHashBefore,
    blockerEvidenceHashOnly: Boolean(taxonomyBlocker && relationshipBlocker)
      && [taxonomyBlocker, relationshipBlocker].every((blocker) =>
        [blocker.baseHash, blocker.localHash, blocker.remoteHash].every(isSha256Hex)
        && ['base', 'local', 'remote'].every((slot) => isSha256Hex(blocker.change?.[slot]?.hash))),
  };
  const evidence = releaseVerifierScope({
    scenario: 'fail-closed-without-custom-taxonomy-identity-map',
    status: 'blocked',
    verdict: 'CUSTOM_TAXONOMY_REFERENCE_FAIL_CLOSED',
    plan: summarizePlan(plan),
    mutationAttempted: false,
    unsupportedSurface: taxonomy,
    applyRefusalCode: error.code,
    remoteHashBefore,
    remoteHashAfter,
    taxonomyBlocker: hashOnlyBlockerEvidence(taxonomyBlocker),
    relationshipBlocker: hashOnlyBlockerEvidence(relationshipBlocker),
    invariants,
    ok: Object.values(invariants).every(Boolean),
  });

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function buildMappedRewriteReleaseVerifierEvidence({ verifiedResourceKeys } = {}) {
  const { base, local, remote } = customTaxonomySnapshots({
    withIdentityMap: true,
    withRemoteTarget: true,
  });
  const plan = planFor(base, local, remote);
  const proof = releaseVerifierProof(plan, { verifiedResourceKeys });
  const releaseRevalidation = proof.apply.applyRevalidation;
  const relationshipMutation = mutationFor(plan, rewrittenRelationshipResourceKey);
  const relationshipPrecondition = preconditionFor(plan, rewrittenRelationshipResourceKey);
  const plannedRelationship = relationshipMutation
    ? deserializeResourceValue(relationshipMutation.value)
    : null;
  const taxonomyRewrite = relationshipMutation?.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'term-relationship-taxonomy') || null;
  const applied = plan.status === 'ready'
    ? applyPlan(cloneJson(remote), plan).site
    : null;
  const finalRelationship = applied?.db?.wp_term_relationships?.[
    `object_id:${postId}|term_taxonomy_id:${targetTermTaxonomyId}`
  ] || null;
  const verifiedBeforeFirstMutation = releaseRevalidation.phase === 'before-first-mutation'
    && releaseRevalidation.checkedAgainst === 'live-remote'
    && releaseRevalidation.verifiedResourceKeys.includes(rewrittenRelationshipResourceKey);
  const invariants = {
    readyPlan: plan.status === 'ready',
    sourceTermMappedToRemote: decisionFor(plan, sourceTermResourceKey)?.decision === 'map-local-identity-to-remote'
      && decisionFor(plan, sourceTermResourceKey)?.targetResourceKey === targetTermResourceKey,
    sourceTaxonomyMappedToRemote: decisionFor(plan, sourceTaxonomyResourceKey)?.decision === 'map-local-identity-to-remote'
      && decisionFor(plan, sourceTaxonomyResourceKey)?.targetResourceKey === targetTaxonomyResourceKey,
    targetRowsPreserved: decisionFor(plan, targetTermResourceKey)?.decision === 'keep-remote'
      && decisionFor(plan, targetTaxonomyResourceKey)?.decision === 'keep-remote',
    sourceRowsNotMutated: ![sourceTermResourceKey, sourceTaxonomyResourceKey, sourceRelationshipResourceKey]
      .some((resourceKey) => mutationFor(plan, resourceKey)),
    relationshipRewrittenToTarget: relationshipMutation?.resourceKey === rewrittenRelationshipResourceKey
      && relationshipMutation?.changeKind === 'create'
      && plannedRelationship?.object_id === postId
      && plannedRelationship?.term_taxonomy_id === targetTermTaxonomyId
      && taxonomyRewrite?.relationshipKey === 'wp_term_relationships.term_taxonomy_id'
      && taxonomyRewrite?.sourceTargetResourceKey === sourceTaxonomyResourceKey
      && taxonomyRewrite?.targetResourceKey === targetTaxonomyResourceKey
      && taxonomyRewrite?.rewrittenResourceKey === rewrittenRelationshipResourceKey,
    rewrittenRelationshipHasLivePrecondition: relationshipPrecondition?.checkedAgainst === 'live-remote'
      && isSha256Hex(relationshipPrecondition?.expectedHash)
      && relationshipPrecondition.expectedHash === relationshipMutation?.remoteBeforeHash,
    rewrittenRelationshipApplyRevalidated: verifiedBeforeFirstMutation,
    applyCarriesRemoteTargetId: finalRelationship?.object_id === postId
      && finalRelationship?.term_taxonomy_id === targetTermTaxonomyId
      && applied?.db?.wp_term_taxonomy?.[`term_taxonomy_id:${targetTermTaxonomyId}`]?.taxonomy === taxonomy,
    noGraphIdentityBlockers: plan.blockers.length === 0,
  };
  const evidence = releaseVerifierScope({
    scenario: 'identity-map-rewrites-custom-taxonomy-relationship',
    status: 'support_only',
    verdict: 'CUSTOM_TAXONOMY_REFERENCE_REWRITTEN_SUPPORT_ONLY',
    acceptedForReleaseGate: false,
    plan: summarizePlan(plan),
    identityMap: {
      sourceTerm: decisionEvidence(decisionFor(plan, sourceTermResourceKey)),
      sourceTaxonomy: decisionEvidence(decisionFor(plan, sourceTaxonomyResourceKey)),
      targetTerm: decisionEvidence(decisionFor(plan, targetTermResourceKey)),
      targetTaxonomy: decisionEvidence(decisionFor(plan, targetTaxonomyResourceKey)),
    },
    rewrite: rewriteEvidence(taxonomyRewrite),
    mutation: relationshipMutation ? {
      resourceKey: relationshipMutation.resourceKey,
      action: relationshipMutation.action,
      changeKind: relationshipMutation.changeKind,
      objectId: plannedRelationship?.object_id ?? null,
      termTaxonomyId: plannedRelationship?.term_taxonomy_id ?? null,
      baseHash: relationshipMutation.baseHash,
      remoteBeforeHash: relationshipMutation.remoteBeforeHash,
      localHash: relationshipMutation.localHash,
      precondition: relationshipPrecondition ? {
        checkedAgainst: relationshipPrecondition.checkedAgainst,
        expectedHash: relationshipPrecondition.expectedHash,
        matchesRemoteBeforeHash: relationshipPrecondition.expectedHash === relationshipMutation.remoteBeforeHash,
      } : null,
    } : null,
    releaseVerifier: {
      planHash: sha256Evidence(proof.planObject),
      applyRevalidation: {
        required: releaseRevalidation.required,
        phase: releaseRevalidation.phase,
        checkedAgainst: releaseRevalidation.checkedAgainst,
        verifiedCount: releaseRevalidation.verifiedCount,
        verifiedResourceKeysHash: sha256Evidence(releaseRevalidation.verifiedResourceKeys),
        verifiedBeforeFirstMutation,
        preconditionSetHash: sha256Evidence(plan.preconditions),
        mutationSetHash: sha256Evidence(plan.mutations),
      },
    },
    applyCarryThrough: {
      accepted: Object.values(invariants).every(Boolean),
      finalRelationshipResourceKey: rewrittenRelationshipResourceKey,
      finalRelationshipObjectId: finalRelationship?.object_id ?? null,
      finalRelationshipTermTaxonomyId: finalRelationship?.term_taxonomy_id ?? null,
      sourceRelationshipAbsent: !applied?.db?.wp_term_relationships?.[
        `object_id:${postId}|term_taxonomy_id:${sourceTermTaxonomyId}`
      ],
      targetTaxonomyHash: applied
        ? sha256Evidence(applied.db.wp_term_taxonomy[`term_taxonomy_id:${targetTermTaxonomyId}`])
        : null,
    },
    invariants,
    ok: Object.values(invariants).every(Boolean),
  });

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function isSha256Hex(value) {
  return typeof value === 'string' && hashPattern.test(value);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function assertNoPrivateCustomTaxonomyFixtures(value, label = 'RPP-0391 custom taxonomy release evidence') {
  const serialized = JSON.stringify(value);
  for (const fixture of privateCustomTaxonomyFixtures) {
    assert.equal(serialized.includes(fixture), false, `${label} leaked ${fixture}`);
  }
  assert.equal(serialized.includes('description'), false, `${label} exposed raw taxonomy description fields`);
  assert.equal(serialized.includes('slug'), false, `${label} exposed raw term slug fields`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0391 release verifier fails closed for custom taxonomy references without identity-map evidence', () => {
  const evidence = buildFailClosedReleaseVerifierEvidence();

  assert.equal(evidence.rpp, 'RPP-0391');
  assert.equal(evidence.evidenceSource, 'release-verifier-custom-taxonomy-fail-closed-reference-v5');
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.verdict, 'CUSTOM_TAXONOMY_REFERENCE_FAIL_CLOSED');
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.mutationAttempted, false);
  assert.equal(evidence.applyRefusalCode, 'PLAN_NOT_READY');
  assert.equal(evidence.remoteHashAfter, evidence.remoteHashBefore);
  assert.deepEqual(evidence.plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.equal(evidence.taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(evidence.taxonomyBlocker.resourceKey, sourceTaxonomyResourceKey);
  assert.equal(evidence.taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.equal(evidence.relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(evidence.relationshipBlocker.resourceKey, sourceRelationshipResourceKey);
  assert.equal(evidence.relationshipBlocker.references[0].relationshipType, 'term-relationship-taxonomy');
  assert.equal(evidence.relationshipBlocker.references[0].targetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(evidence.relationshipBlocker.references[0].targetSupport.className, 'stale-wordpress-graph-identity');
  assert.deepEqual(evidence.invariants, {
    blockedPlan: true,
    taxonomyMutationAbsent: true,
    relationshipMutationAbsent: true,
    standaloneTermMutationPlannedButNotApplied: true,
    customTaxonomySurfaceRejected: true,
    relationshipTargetRejected: true,
    applyRefusedBeforeMutation: true,
    blockerEvidenceHashOnly: true,
  });
  assert.equal(evidence.ok, true);
  assertSha256Evidence(evidence.proofHash, 'RPP-0391 fail-closed proof hash');
  assertNoPrivateCustomTaxonomyFixtures(evidence, 'RPP-0391 fail-closed release evidence');
});

test('RPP-0391 release verifier carries custom taxonomy identity-map rewrite through apply revalidation', () => {
  const evidence = buildMappedRewriteReleaseVerifierEvidence();

  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'CUSTOM_TAXONOMY_REFERENCE_REWRITTEN_SUPPORT_ONLY');
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.acceptedForReleaseGate, false);
  assert.deepEqual(evidence.plan.summary, {
    mutations: 1,
    decisions: 4,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(evidence.identityMap.sourceTerm.decision, 'map-local-identity-to-remote');
  assert.equal(evidence.identityMap.sourceTerm.targetResourceKey, targetTermResourceKey);
  assert.equal(evidence.identityMap.sourceTaxonomy.decision, 'map-local-identity-to-remote');
  assert.equal(evidence.identityMap.sourceTaxonomy.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(evidence.identityMap.targetTerm.decision, 'keep-remote');
  assert.equal(evidence.identityMap.targetTaxonomy.decision, 'keep-remote');
  assert.equal(evidence.rewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(evidence.rewrite.relationshipType, 'term-relationship-taxonomy');
  assert.equal(evidence.rewrite.sourceTargetResourceKey, sourceTaxonomyResourceKey);
  assert.equal(evidence.rewrite.targetResourceKey, targetTaxonomyResourceKey);
  assert.equal(evidence.rewrite.rewrittenResourceKey, rewrittenRelationshipResourceKey);
  assert.match(evidence.rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(evidence.rewrite.targetRemoteHash, hashPattern);
  assert.equal(evidence.mutation.resourceKey, rewrittenRelationshipResourceKey);
  assert.equal(evidence.mutation.action, 'put');
  assert.equal(evidence.mutation.changeKind, 'create');
  assert.equal(evidence.mutation.objectId, postId);
  assert.equal(evidence.mutation.termTaxonomyId, targetTermTaxonomyId);
  assert.equal(evidence.mutation.precondition.checkedAgainst, 'live-remote');
  assert.equal(evidence.mutation.precondition.matchesRemoteBeforeHash, true);
  assert.equal(evidence.releaseVerifier.applyRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(evidence.applyCarryThrough.accepted, true);
  assert.equal(evidence.applyCarryThrough.finalRelationshipResourceKey, rewrittenRelationshipResourceKey);
  assert.equal(evidence.applyCarryThrough.finalRelationshipObjectId, postId);
  assert.equal(evidence.applyCarryThrough.finalRelationshipTermTaxonomyId, targetTermTaxonomyId);
  assert.equal(evidence.applyCarryThrough.sourceRelationshipAbsent, true);
  assert.deepEqual(evidence.invariants, {
    readyPlan: true,
    sourceTermMappedToRemote: true,
    sourceTaxonomyMappedToRemote: true,
    targetRowsPreserved: true,
    sourceRowsNotMutated: true,
    relationshipRewrittenToTarget: true,
    rewrittenRelationshipHasLivePrecondition: true,
    rewrittenRelationshipApplyRevalidated: true,
    applyCarriesRemoteTargetId: true,
    noGraphIdentityBlockers: true,
  });
  assert.equal(evidence.ok, true);
  assertSha256Evidence(evidence.proofHash, 'RPP-0391 mapped rewrite proof hash');
  assertNoPrivateCustomTaxonomyFixtures(evidence, 'RPP-0391 mapped rewrite release evidence');
});

test('RPP-0391 release verifier evidence fails closed if the rewritten custom taxonomy row is not revalidated', () => {
  const evidence = buildMappedRewriteReleaseVerifierEvidence({ verifiedResourceKeys: [] });

  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.releaseVerifier.applyRevalidation.verifiedCount, 0);
  assert.equal(evidence.releaseVerifier.applyRevalidation.verifiedBeforeFirstMutation, false);
  assert.equal(evidence.invariants.rewrittenRelationshipApplyRevalidated, false);
  assert.equal(evidence.applyCarryThrough.accepted, false);
  assert.equal(evidence.ok, false);
  assertSha256Evidence(evidence.proofHash, 'RPP-0391 missing-revalidation proof hash');
  assertNoPrivateCustomTaxonomyFixtures(evidence, 'RPP-0391 missing-revalidation release evidence');
});
