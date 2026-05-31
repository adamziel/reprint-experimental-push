import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0351-custom-taxonomy-fail-closed-reference-v3.md',
);

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const hashOrSha256Pattern = /^(?:sha256:)?[a-f0-9]{64}$/;
const taxonomy = 'product_cat';

test('RPP-0351 generated custom taxonomy fail-closed cases refuse before mutation with hash-only evidence', () => {
  for (const fixture of generatedCustomTaxonomyFailClosedFixtures()) {
    const plan = planFor(fixture.base, fixture.local, fixture.remote);
    const taxonomyBlocker = blockerFor(plan, fixture.sourceTaxonomyResourceKey);
    const relationshipBlocker = blockerFor(plan, fixture.sourceRelationshipResourceKey);
    const targetReference = relationshipBlocker?.references.find((entry) =>
      entry.relationshipType === 'term-relationship-taxonomy');
    const evidence = failClosedReferenceEvidence({
      fixture,
      plan,
      taxonomyBlocker,
      relationshipBlocker,
    });

    assert.equal(plan.status, 'blocked', `${fixture.variant} plan`);
    assert.equal(mutationFor(plan, fixture.sourceTaxonomyResourceKey), undefined);
    assert.equal(mutationFor(plan, fixture.sourceRelationshipResourceKey), undefined);
    assert.ok(taxonomyBlocker, `${fixture.variant} taxonomy blocker`);
    assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
    assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface product_cat/);
    assert.equal(taxonomyBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
    assert.ok(relationshipBlocker, `${fixture.variant} relationship blocker`);
    assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
    assert.match(
      relationshipBlocker.reason,
      /without proven identity mapping or reference rewriting/,
    );
    assert.ok(targetReference, `${fixture.variant} relationship target evidence`);
    assert.equal(targetReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
    assert.equal(targetReference.relationshipType, 'term-relationship-taxonomy');
    assert.equal(targetReference.targetResourceKey, fixture.sourceTaxonomyResourceKey);
    assert.deepEqual(targetReference.targetSupport, {
      supported: false,
      className: 'stale-wordpress-graph-identity',
      reason: `WordPress graph mutation ${fixture.sourceTaxonomyResourceKey} references unsupported taxonomy graph surface product_cat.`,
    });
    assertHashOnlyBlocker(taxonomyBlocker);
    assertHashOnlyBlocker(relationshipBlocker);
    assertHashOnlyTargetReference(targetReference);

    if (fixture.expectedSourceTermDecision) {
      assert.equal(
        decisionFor(plan, fixture.sourceTermResourceKey)?.decision,
        fixture.expectedSourceTermDecision,
        `${fixture.variant} source term decision`,
      );
    }

    assert.equal(evidence.ok, true, `${fixture.variant} proof`);
    assert.equal(evidence.variant, fixture.variant);
    assert.equal(evidence.release.finalRecommendation, 'NO-GO');
    assert.deepEqual(evidence, failClosedReferenceEvidence({
      fixture,
      plan,
      taxonomyBlocker,
      relationshipBlocker,
    }), `${fixture.variant} proof is deterministic`);
    assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
  }
});

test('RPP-0351 rewrites generated custom taxonomy relationship only with explicit target identity map', () => {
  const fixture = mappedCustomTaxonomyFixture();
  const plan = planFor(fixture.base, fixture.local, fixture.remote);
  const applied = applyPlan(cloneJson(fixture.remote), plan);
  const evidence = mappedRewriteEvidence({ fixture, plan, applied });
  const relationshipMutation = mutationFor(plan, fixture.rewrittenRelationshipResourceKey);
  const plannedRelationship = deserializeResourceValue(relationshipMutation?.value);
  const rewrite = relationshipMutation?.wordpressGraphIdentity?.rewrites?.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockers, []);
  assert.equal(mutationFor(plan, fixture.sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, fixture.sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, fixture.sourceRelationshipResourceKey), undefined);
  assert.equal(decisionFor(plan, fixture.sourceTermResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, fixture.sourceTaxonomyResourceKey)?.decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, fixture.targetTermResourceKey)?.decision, 'keep-remote');
  assert.equal(decisionFor(plan, fixture.targetTaxonomyResourceKey)?.decision, 'keep-remote');

  assert.ok(relationshipMutation, 'missing rewritten custom taxonomy relationship mutation');
  assert.equal(relationshipMutation.resourceKey, fixture.rewrittenRelationshipResourceKey);
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.deepEqual(plannedRelationship, {
    object_id: fixture.postId,
    term_taxonomy_id: fixture.targetTaxonomyId,
    term_order: 0,
  });
  assert.ok(rewrite, 'missing custom taxonomy rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(rewrite.field, 'term_taxonomy_id');
  assert.equal(rewrite.sourceResourceKey, fixture.sourceRelationshipResourceKey);
  assert.equal(rewrite.sourceTargetResourceKey, fixture.sourceTaxonomyResourceKey);
  assert.equal(rewrite.targetResourceKey, fixture.targetTaxonomyResourceKey);
  assert.equal(rewrite.rewrittenResourceKey, fixture.rewrittenRelationshipResourceKey);
  assert.match(rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(rewrite.targetRemoteHash, hashPattern);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(applied.appliedMutations, 1);
  assert.equal(
    applied.site.db.wp_term_relationships[
      `object_id:${fixture.postId}|term_taxonomy_id:${fixture.sourceTaxonomyId}`
    ],
    undefined,
  );
  assert.deepEqual(
    applied.site.db.wp_term_relationships[
      `object_id:${fixture.postId}|term_taxonomy_id:${fixture.targetTaxonomyId}`
    ],
    plannedRelationship,
  );
  assert.equal(
    applied.site.db.wp_term_taxonomy[`term_taxonomy_id:${fixture.targetTaxonomyId}`].taxonomy,
    taxonomy,
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.variant, 'ready-explicit-identity-map-rewrite');
  assert.equal(evidence.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(evidence.invariants, {
    planReady: true,
    sourceTermMapped: true,
    sourceTaxonomyMapped: true,
    remoteTargetsPreserved: true,
    sourceRowsNotMutated: true,
    relationshipRewrittenToTarget: true,
    livePrecondition: true,
    applyCarriedTarget: true,
  });
  assert.deepEqual(evidence, mappedRewriteEvidence({ fixture, plan, applied }), 'mapped proof is deterministic');
  assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
});

test('RPP-0351 evidence document labels local support and NO-GO release posture', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0351 custom taxonomy fail-closed reference v3 evidence$/m);
  assert.match(evidenceDoc, /local support evidence/i);
  assert.match(evidenceDoc, /Final release posture: `NO-GO`/);
  assert.match(evidenceDoc, /hash-only graph evidence/i);
  assert.doesNotMatch(evidenceDoc, /docs\/reprint-push-completion-checklist\.md/);
  assert.doesNotMatch(evidenceDoc, /progress\.html/);
});

function generatedCustomTaxonomyFailClosedFixtures() {
  return [
    unsupportedCustomTaxonomyFixture(),
    unmappedCustomTaxonomyTargetFixture(),
  ];
}

function unsupportedCustomTaxonomyFixture() {
  const postId = 351001;
  const sourceTermId = 351101;
  const sourceTaxonomyId = 351111;
  const base = baseSite({ postId, title: 'RPP-0351 unsupported custom taxonomy base' });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_terms[`term_id:${sourceTermId}`] = customTerm({
    termId: sourceTermId,
    name: 'RPP-0351 Private Product Category',
    slug: 'rpp-0351-private-product-category',
  });
  local.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTaxonomyId}`] = customTaxonomy({
    termTaxonomyId: sourceTaxonomyId,
    termId: sourceTermId,
    description: 'rpp-0351 private custom taxonomy description',
  });
  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`] = termRelationship({
    postId,
    termTaxonomyId: sourceTaxonomyId,
  });

  return failClosedFixtureShape({
    variant: 'unsupported-custom-taxonomy-target',
    base,
    local,
    remote,
    postId,
    sourceTermId,
    sourceTaxonomyId,
    rawFixtureSentinels: [
      'RPP-0351 Private Product Category',
      'rpp-0351-private-product-category',
      'rpp-0351 private custom taxonomy description',
    ],
  });
}

function unmappedCustomTaxonomyTargetFixture() {
  const postId = 351201;
  const sourceTermId = 351301;
  const targetTermId = 351401;
  const sourceTaxonomyId = 351311;
  const targetTaxonomyId = 351411;
  const base = baseSite({ postId, title: 'RPP-0351 unmapped custom taxonomy base' });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta.wordpressGraphIdentityMap = {
    rows: [
      { table: 'wp_terms', localId: `term_id:${sourceTermId}`, remoteId: `term_id:${targetTermId}` },
    ],
  };
  local.db.wp_terms[`term_id:${sourceTermId}`] = customTerm({
    termId: sourceTermId,
    name: 'RPP-0351 Partially Mapped Product Category',
    slug: 'rpp-0351-partially-mapped-product-category',
  });
  remote.db.wp_terms[`term_id:${targetTermId}`] = customTerm({
    termId: targetTermId,
    name: 'RPP-0351 Partially Mapped Product Category',
    slug: 'rpp-0351-partially-mapped-product-category',
  });
  local.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTaxonomyId}`] = customTaxonomy({
    termTaxonomyId: sourceTaxonomyId,
    termId: sourceTermId,
    description: 'rpp-0351 partially mapped source taxonomy description',
  });
  remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`] = customTaxonomy({
    termTaxonomyId: targetTaxonomyId,
    termId: targetTermId,
    description: 'rpp-0351 partially mapped source taxonomy description',
  });
  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`] = termRelationship({
    postId,
    termTaxonomyId: sourceTaxonomyId,
  });

  return failClosedFixtureShape({
    variant: 'term-mapped-taxonomy-target-unmapped',
    base,
    local,
    remote,
    postId,
    sourceTermId,
    sourceTaxonomyId,
    targetTermId,
    targetTaxonomyId,
    expectedSourceTermDecision: 'map-local-identity-to-remote',
    rawFixtureSentinels: [
      'RPP-0351 Partially Mapped Product Category',
      'rpp-0351-partially-mapped-product-category',
      'rpp-0351 partially mapped source taxonomy description',
    ],
  });
}

function mappedCustomTaxonomyFixture() {
  const postId = 351501;
  const sourceTermId = 351601;
  const targetTermId = 351701;
  const sourceTaxonomyId = 351611;
  const targetTaxonomyId = 351711;
  const base = baseSite({ postId, title: 'RPP-0351 mapped custom taxonomy base' });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta.wordpressGraphIdentityMap = {
    rows: [
      { table: 'wp_terms', localId: `term_id:${sourceTermId}`, remoteId: `term_id:${targetTermId}` },
      {
        table: 'wp_term_taxonomy',
        localId: `term_taxonomy_id:${sourceTaxonomyId}`,
        remoteId: `term_taxonomy_id:${targetTaxonomyId}`,
      },
    ],
  };
  local.db.wp_terms[`term_id:${sourceTermId}`] = customTerm({
    termId: sourceTermId,
    name: 'RPP-0351 Mapped Product Category',
    slug: 'rpp-0351-mapped-product-category',
  });
  remote.db.wp_terms[`term_id:${targetTermId}`] = customTerm({
    termId: targetTermId,
    name: 'RPP-0351 Mapped Product Category',
    slug: 'rpp-0351-mapped-product-category',
  });
  local.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTaxonomyId}`] = customTaxonomy({
    termTaxonomyId: sourceTaxonomyId,
    termId: sourceTermId,
    description: 'rpp-0351 mapped custom taxonomy description',
  });
  remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`] = customTaxonomy({
    termTaxonomyId: targetTaxonomyId,
    termId: targetTermId,
    description: 'rpp-0351 mapped custom taxonomy description',
  });
  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`] = termRelationship({
    postId,
    termTaxonomyId: sourceTaxonomyId,
  });

  return {
    base,
    local,
    remote,
    postId,
    sourceTermId,
    targetTermId,
    sourceTaxonomyId,
    targetTaxonomyId,
    sourceTermResourceKey: rowResourceKey('wp_terms', `term_id:${sourceTermId}`),
    targetTermResourceKey: rowResourceKey('wp_terms', `term_id:${targetTermId}`),
    sourceTaxonomyResourceKey: rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${sourceTaxonomyId}`),
    targetTaxonomyResourceKey: rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${targetTaxonomyId}`),
    sourceRelationshipResourceKey: rowResourceKey(
      'wp_term_relationships',
      `object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`,
    ),
    rewrittenRelationshipResourceKey: rowResourceKey(
      'wp_term_relationships',
      `object_id:${postId}|term_taxonomy_id:${targetTaxonomyId}`,
    ),
    rawFixtureSentinels: [
      'RPP-0351 Mapped Product Category',
      'rpp-0351-mapped-product-category',
      'rpp-0351 mapped custom taxonomy description',
    ],
  };
}

function failClosedFixtureShape({
  variant,
  base,
  local,
  remote,
  postId,
  sourceTermId,
  sourceTaxonomyId,
  targetTermId = null,
  targetTaxonomyId = null,
  expectedSourceTermDecision = null,
  rawFixtureSentinels,
}) {
  return {
    variant,
    base,
    local,
    remote,
    postId,
    sourceTermId,
    sourceTaxonomyId,
    targetTermId,
    targetTaxonomyId,
    expectedSourceTermDecision,
    sourceTermResourceKey: rowResourceKey('wp_terms', `term_id:${sourceTermId}`),
    targetTermResourceKey: targetTermId ? rowResourceKey('wp_terms', `term_id:${targetTermId}`) : null,
    sourceTaxonomyResourceKey: rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${sourceTaxonomyId}`),
    targetTaxonomyResourceKey: targetTaxonomyId
      ? rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${targetTaxonomyId}`)
      : null,
    sourceRelationshipResourceKey: rowResourceKey(
      'wp_term_relationships',
      `object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`,
    ),
    rawFixtureSentinels,
  };
}

function failClosedReferenceEvidence({
  fixture,
  plan,
  taxonomyBlocker,
  relationshipBlocker,
}) {
  const relationshipReference = relationshipBlocker?.references.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const remoteAttempt = cloneJson(fixture.remote);
  const remoteBeforeHash = digest(remoteAttempt);
  const error = captureError(() => applyPlan(remoteAttempt, plan));
  const remoteAfterHash = digest(remoteAttempt);
  const sourceTermDecision = decisionFor(plan, fixture.sourceTermResourceKey);
  const sourceTaxonomyDecision = decisionFor(plan, fixture.sourceTaxonomyResourceKey);
  const targetTaxonomyDecision = fixture.targetTaxonomyResourceKey
    ? decisionFor(plan, fixture.targetTaxonomyResourceKey)
    : null;
  const invariants = {
    planBlocked: plan.status === 'blocked',
    taxonomyBlocked: taxonomyBlocker?.class === 'stale-wordpress-graph-identity',
    relationshipBlocked: relationshipBlocker?.class === 'stale-wordpress-graph-identity',
    noTaxonomyMutation: mutationFor(plan, fixture.sourceTaxonomyResourceKey) === undefined,
    noRelationshipMutation: mutationFor(plan, fixture.sourceRelationshipResourceKey) === undefined,
    relationshipTargetSupportFailed: relationshipReference?.targetSupport?.supported === false
      && relationshipReference?.targetSupport?.className === 'stale-wordpress-graph-identity',
    refusedBeforeMutation: error instanceof PushPlanError
      && error.code === 'PLAN_NOT_READY'
      && remoteBeforeHash === remoteAfterHash,
  };
  const proof = {
    target: 'customTaxonomyFailClosedReferenceVariant3',
    variant: fixture.variant,
    evidenceScope: 'local-graph-identity-support-proof',
    productionBacked: false,
    releaseGate: 'NO-GO',
    taxonomy,
    plan: {
      status: plan.status,
      summary: plan.summary,
      hash: `sha256:${digest(plan)}`,
    },
    resourceKeys: {
      sourceTerm: fixture.sourceTermResourceKey,
      targetTerm: fixture.targetTermResourceKey,
      sourceTermTaxonomy: fixture.sourceTaxonomyResourceKey,
      targetTermTaxonomy: fixture.targetTaxonomyResourceKey,
      sourceRelationship: fixture.sourceRelationshipResourceKey,
    },
    decisions: {
      sourceTerm: decisionSummary(sourceTermDecision),
      sourceTermTaxonomy: decisionSummary(sourceTaxonomyDecision),
      targetTermTaxonomy: decisionSummary(targetTaxonomyDecision),
    },
    blockers: [
      hashOnlyBlockerSummary(taxonomyBlocker),
      hashOnlyBlockerSummary(relationshipBlocker),
    ],
    relationship: {
      relationshipKey: relationshipReference?.relationshipKey || null,
      relationshipType: relationshipReference?.relationshipType || null,
      targetResourceKey: relationshipReference?.targetResourceKey || null,
      targetSupportClass: relationshipReference?.targetSupport?.className || null,
      targetSupportReasonHash: `sha256:${digest(relationshipReference?.targetSupport?.reason || '')}`,
    },
    hashes: {
      targetBase: relationshipReference?.targetBaseHash || null,
      targetLocal: relationshipReference?.targetLocalHash || null,
      targetRemote: relationshipReference?.targetRemoteHash || null,
      targetChangeBase: relationshipReference?.targetChange?.base?.hash || null,
      targetChangeLocal: relationshipReference?.targetChange?.local?.hash || null,
      targetChangeRemote: relationshipReference?.targetChange?.remote?.hash || null,
      remoteBefore: remoteBeforeHash,
      remoteAfter: remoteAfterHash,
      refusalDetails: `sha256:${digest(error.details)}`,
    },
    refusal: {
      code: error.code,
      phase: 'before-mutation',
    },
    release: {
      productionBacked: false,
      finalRecommendation: 'NO-GO',
      caveat: 'local-support-evidence-only',
    },
    invariants,
  };

  return {
    ...proof,
    ok: Object.values(invariants).every(Boolean),
    proofHash: `sha256:${digest(proof)}`,
  };
}

function mappedRewriteEvidence({ fixture, plan, applied }) {
  const sourceTermDecision = decisionFor(plan, fixture.sourceTermResourceKey);
  const sourceTaxonomyDecision = decisionFor(plan, fixture.sourceTaxonomyResourceKey);
  const targetTermDecision = decisionFor(plan, fixture.targetTermResourceKey);
  const targetTaxonomyDecision = decisionFor(plan, fixture.targetTaxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, fixture.rewrittenRelationshipResourceKey);
  const relationshipPrecondition = preconditionFor(plan, relationshipMutation);
  const plannedRelationship = deserializeResourceValue(relationshipMutation?.value);
  const rewrite = relationshipMutation?.wordpressGraphIdentity?.rewrites?.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const appliedRelationshipHash = resourceHash(
    applied.site,
    rowResource('wp_term_relationships', `object_id:${fixture.postId}|term_taxonomy_id:${fixture.targetTaxonomyId}`),
  );
  const remoteTargetTaxonomyHash = resourceHash(
    fixture.remote,
    rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.targetTaxonomyId}`),
  );
  const appliedTargetTaxonomyHash = resourceHash(
    applied.site,
    rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.targetTaxonomyId}`),
  );
  const invariants = {
    planReady: plan.status === 'ready',
    sourceTermMapped: sourceTermDecision?.decision === 'map-local-identity-to-remote'
      && sourceTermDecision?.targetResourceKey === fixture.targetTermResourceKey,
    sourceTaxonomyMapped: sourceTaxonomyDecision?.decision === 'map-local-identity-to-remote'
      && sourceTaxonomyDecision?.targetResourceKey === fixture.targetTaxonomyResourceKey,
    remoteTargetsPreserved: targetTermDecision?.decision === 'keep-remote'
      && targetTaxonomyDecision?.decision === 'keep-remote'
      && remoteTargetTaxonomyHash === appliedTargetTaxonomyHash,
    sourceRowsNotMutated: ![
      fixture.sourceTermResourceKey,
      fixture.sourceTaxonomyResourceKey,
      fixture.sourceRelationshipResourceKey,
    ].some((resourceKey) => mutationFor(plan, resourceKey)),
    relationshipRewrittenToTarget: relationshipMutation?.resourceKey === fixture.rewrittenRelationshipResourceKey
      && plannedRelationship?.term_taxonomy_id === fixture.targetTaxonomyId
      && rewrite?.sourceTargetResourceKey === fixture.sourceTaxonomyResourceKey
      && rewrite?.targetResourceKey === fixture.targetTaxonomyResourceKey,
    livePrecondition: relationshipPrecondition?.checkedAgainst === 'live-remote'
      && relationshipPrecondition?.expectedHash === relationshipMutation?.remoteBeforeHash,
    applyCarriedTarget: appliedRelationshipHash === relationshipMutation?.localHash,
  };
  const proof = {
    target: 'customTaxonomyFailClosedReferenceVariant3',
    variant: 'ready-explicit-identity-map-rewrite',
    evidenceScope: 'local-graph-identity-support-proof',
    productionBacked: false,
    releaseGate: 'NO-GO',
    taxonomy,
    plan: {
      status: plan.status,
      summary: plan.summary,
      hash: `sha256:${digest(plan)}`,
    },
    resourceKeys: {
      sourceTerm: fixture.sourceTermResourceKey,
      targetTerm: fixture.targetTermResourceKey,
      sourceTermTaxonomy: fixture.sourceTaxonomyResourceKey,
      targetTermTaxonomy: fixture.targetTaxonomyResourceKey,
      sourceRelationship: fixture.sourceRelationshipResourceKey,
      rewrittenRelationship: fixture.rewrittenRelationshipResourceKey,
    },
    identityMap: {
      sourceTerm: decisionSummary(sourceTermDecision),
      sourceTermTaxonomy: decisionSummary(sourceTaxonomyDecision),
      targetTerm: decisionSummary(targetTermDecision),
      targetTermTaxonomy: decisionSummary(targetTaxonomyDecision),
    },
    relationship: {
      relationshipKey: rewrite?.relationshipKey || null,
      relationshipType: rewrite?.relationshipType || null,
      field: rewrite?.field || null,
      plannedObjectId: Number(plannedRelationship?.object_id),
      plannedTermTaxonomyId: Number(plannedRelationship?.term_taxonomy_id),
      rewriteHash: `sha256:${digest(rewrite)}`,
    },
    hashes: {
      sourceTargetLocal: rewrite?.sourceTargetLocalHash || null,
      targetRemote: rewrite?.targetRemoteHash || null,
      relationshipRemoteBefore: relationshipMutation?.remoteBeforeHash || null,
      relationshipPrecondition: relationshipPrecondition?.expectedHash || null,
      relationshipPlannedLocal: relationshipMutation?.localHash || null,
      relationshipApplied: appliedRelationshipHash,
      targetTermTaxonomyRemote: remoteTargetTaxonomyHash,
      targetTermTaxonomyApplied: appliedTargetTaxonomyHash,
    },
    release: {
      productionBacked: false,
      finalRecommendation: 'NO-GO',
      caveat: 'local-support-evidence-only',
    },
    invariants,
  };

  return {
    ...proof,
    ok: Object.values(invariants).every(Boolean),
    proofHash: `sha256:${digest(proof)}`,
  };
}

function decisionSummary(decision) {
  if (!decision) {
    return null;
  }
  return {
    resourceKey: decision.resourceKey,
    decision: decision.decision,
    targetResourceKey: decision.targetResourceKey || null,
    identityMapSource: decision.identityMapSource || null,
    baseHash: decision.baseHash || null,
    localHash: decision.localHash || null,
    remoteHash: decision.remoteHash || null,
    targetRemoteHash: decision.targetRemoteHash || null,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function hashOnlyBlockerSummary(blocker) {
  return {
    resourceKey: blocker?.resourceKey || null,
    class: blocker?.class || null,
    resolutionPolicy: blocker?.resolutionPolicy || null,
    reasonHash: `sha256:${digest(blocker?.reason || '')}`,
    hashes: {
      base: blocker?.baseHash || null,
      local: blocker?.localHash || null,
      remote: blocker?.remoteHash || null,
      changeBase: blocker?.change?.base?.hash || null,
      changeLocal: blocker?.change?.local?.hash || null,
      changeRemote: blocker?.change?.remote?.hash || null,
    },
  };
}

function baseSite({ postId, title }) {
  return {
    meta: {
      fixture: 'rpp-0351-custom-taxonomy-fail-closed-reference-v3',
    },
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: title,
          post_name: `rpp-0351-post-${postId}`,
          post_content: 'RPP-0351 custom taxonomy anchor post.',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
    },
  };
}

function customTerm({ termId, name, slug }) {
  return {
    term_id: termId,
    name,
    slug,
    term_group: 0,
  };
}

function customTaxonomy({ termTaxonomyId, termId, description }) {
  return {
    term_taxonomy_id: termTaxonomyId,
    term_id: termId,
    taxonomy,
    description,
    parent: 0,
    count: 1,
  };
}

function termRelationship({ postId, termTaxonomyId }) {
  return {
    object_id: postId,
    term_taxonomy_id: termTaxonomyId,
    term_order: 0,
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) =>
    precondition.mutationId === mutation?.id
    && precondition.resourceKey === mutation?.resourceKey);
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
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing live precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function assertHashOnlyBlocker(blocker) {
  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    blocker.change.base.hash,
    blocker.change.local.hash,
    blocker.change.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(blocker.change.base, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.remote, 'value'), false);
}

function assertHashOnlyTargetReference(reference) {
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
    reference.targetChange.base.hash,
    reference.targetChange.local.hash,
    reference.targetChange.remote.hash,
  ]) {
    assert.match(hash, hashPattern);
  }
  assert.equal(Object.hasOwn(reference.targetChange.base, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
  assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
}

function assertHashOnlyGraphEvidence(evidence, rawFixtureSentinels) {
  assertNoPayloadKeys(evidence);
  for (const hash of collectHashEvidenceStrings(evidence)) {
    assert.match(hash, hashOrSha256Pattern);
  }

  const serialized = JSON.stringify(evidence);
  for (const rawFixtureSentinel of rawFixtureSentinels) {
    assert.equal(
      serialized.includes(rawFixtureSentinel),
      false,
      `hash-only graph evidence leaked ${rawFixtureSentinel}`,
    );
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, {
    label: 'RPP-0351 custom taxonomy graph evidence',
  }));
}

function assertNoPayloadKeys(value) {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.notEqual(key, 'value', 'hash-only graph evidence must not include raw value payloads');
    assert.notEqual(key, 'rawValue', 'hash-only graph evidence must not include rawValue payloads');
    assert.notEqual(key, 'values', 'hash-only graph evidence must not include raw values payloads');
    assert.notEqual(key, 'payload', 'hash-only graph evidence must not include payload fields');
    assertNoPayloadKeys(nested);
  }
}

function collectHashEvidenceStrings(value) {
  const hashes = [];
  collectHashEvidenceStringsInto(value, hashes);
  return hashes;
}

function collectHashEvidenceStringsInto(value, hashes, parentKey = '') {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectHashEvidenceStringsInto(entry, hashes, parentKey);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      typeof nested === 'string'
      && (parentKey === 'hashes' || /hash/i.test(key))
      && nested !== ''
    ) {
      hashes.push(nested);
    }
    collectHashEvidenceStringsInto(nested, hashes, key);
  }
}
