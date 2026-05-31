import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0350-post-tag-taxonomy-reference-v3.md',
);

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const hashOrSha256Pattern = /^(?:sha256:)?[a-f0-9]{64}$/;

test('RPP-0350 carries a mapped post_tag term_taxonomy target through apply-shaped proof', () => {
  const fixture = mappedPostTagFixture();
  const plan = planFor(fixture.base, fixture.local, fixture.remote);
  const applied = applyPlan(cloneJson(fixture.remote), plan);
  const evidence = mappedPostTagTaxonomyReferenceEvidence({ fixture, plan, applied });
  const relationshipMutation = mutationFor(plan, fixture.rewrittenRelationshipResourceKey);
  const relationshipValue = deserializeResourceValue(relationshipMutation.value);
  const rewrite = relationshipMutation.wordpressGraphIdentity.rewrites.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockers, []);
  assert.equal(mutationFor(plan, fixture.sourceTermResourceKey), undefined);
  assert.equal(mutationFor(plan, fixture.sourceTaxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, fixture.sourceRelationshipResourceKey), undefined);
  assert.equal(decisionFor(plan, fixture.sourceTermResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, fixture.sourceTermResourceKey).targetResourceKey, fixture.targetTermResourceKey);
  assert.equal(decisionFor(plan, fixture.sourceTaxonomyResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, fixture.sourceTaxonomyResourceKey).targetResourceKey, fixture.targetTaxonomyResourceKey);
  assert.equal(decisionFor(plan, fixture.targetTermResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, fixture.targetTaxonomyResourceKey).decision, 'keep-remote');

  assert.ok(relationshipMutation, 'missing rewritten post_tag relationship mutation');
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(relationshipMutation.resourceKey, fixture.rewrittenRelationshipResourceKey);
  assert.equal(relationshipMutation.wordpressGraphIdentity.sourceResourceKey, fixture.sourceRelationshipResourceKey);
  assert.deepEqual(relationshipValue, {
    object_id: fixture.postId,
    term_taxonomy_id: fixture.targetTaxonomyId,
    term_order: 0,
  });
  assert.ok(rewrite, 'missing term_taxonomy_id rewrite evidence');
  assert.equal(rewrite.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(rewrite.field, 'term_taxonomy_id');
  assert.equal(rewrite.sourceTargetResourceKey, fixture.sourceTaxonomyResourceKey);
  assert.equal(rewrite.targetResourceKey, fixture.targetTaxonomyResourceKey);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(applied.appliedMutations, plan.mutations.length);
  assert.equal(
    applied.site.db.wp_term_relationships[`object_id:${fixture.postId}|term_taxonomy_id:${fixture.sourceTaxonomyId}`],
    undefined,
  );
  assert.deepEqual(
    applied.site.db.wp_term_relationships[
      `object_id:${fixture.postId}|term_taxonomy_id:${fixture.targetTaxonomyId}`
    ],
    relationshipValue,
  );
  assert.equal(
    applied.site.db.wp_term_taxonomy[`term_taxonomy_id:${fixture.targetTaxonomyId}`].taxonomy,
    'post_tag',
  );
  assert.equal(
    applied.site.db.wp_term_taxonomy[`term_taxonomy_id:${fixture.targetTaxonomyId}`].term_id,
    fixture.targetTermId,
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.evidenceScope, 'local-graph-identity-apply-shaped');
  assert.equal(evidence.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(evidence.invariants, {
    planReady: true,
    sourceTermMapped: true,
    sourceTaxonomyMapped: true,
    targetTermTaxonomyPreserved: true,
    relationshipRewrittenToTarget: true,
    livePrecondition: true,
    applyCarriedTarget: true,
    noSourceRelationshipMutation: true,
  });
  assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
});

test('RPP-0350 proves stable post_tag term_taxonomy identity without rewrite', () => {
  const fixture = stablePostTagFixture();
  const plan = planFor(fixture.base, fixture.local, fixture.remote);
  const applied = applyPlan(cloneJson(fixture.remote), plan);
  const evidence = stablePostTagTaxonomyReferenceEvidence({ fixture, plan, applied });
  const relationshipMutation = mutationFor(plan, fixture.relationshipResourceKey);
  const relationshipValue = deserializeResourceValue(relationshipMutation.value);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.blockers, []);
  assert.equal(decisionFor(plan, fixture.taxonomyResourceKey), undefined);
  assert.ok(relationshipMutation, 'missing stable post_tag relationship mutation');
  assert.equal(relationshipMutation.action, 'put');
  assert.equal(relationshipMutation.changeKind, 'create');
  assert.equal(relationshipMutation.wordpressGraphIdentity, undefined);
  assert.deepEqual(relationshipValue, {
    object_id: fixture.postId,
    term_taxonomy_id: fixture.termTaxonomyId,
    term_order: 0,
  });
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(
    resourceHash(applied.site, rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.termTaxonomyId}`)),
    resourceHash(fixture.remote, rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.termTaxonomyId}`)),
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.variant, 'ready-stable-term-taxonomy-identity');
  assert.equal(evidence.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(evidence.invariants, {
    planReady: true,
    mutationPresent: true,
    noIdentityRewrite: true,
    termTaxonomyStable: true,
    relationshipCarriesStableTarget: true,
    livePrecondition: true,
    applyCarriedTarget: true,
  });
  assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
});

test('RPP-0350 stale post_tag term_taxonomy evidence fails closed before mutation', () => {
  const fixture = stalePostTagFixture();
  const plan = planFor(fixture.base, fixture.local, fixture.remote);
  const blocker = blockerFor(plan, fixture.relationshipResourceKey);
  const targetReference = blocker?.references.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const evidence = blockedPostTagTaxonomyEvidence({
    fixture,
    plan,
    blocker,
    variant: 'stale-post-tag-term-taxonomy-target',
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(decisionFor(plan, fixture.taxonomyResourceKey).decision, 'keep-remote');
  assert.equal(mutationFor(plan, fixture.relationshipResourceKey), undefined);
  assert.ok(blocker, 'missing stale post_tag relationship blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.match(blocker.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.ok(targetReference, 'missing stale post_tag target evidence');
  assert.equal(targetReference.relationshipKey, 'wp_term_relationships.term_taxonomy_id');
  assert.equal(targetReference.targetResourceKey, fixture.taxonomyResourceKey);
  assert.equal(targetReference.targetChange.localChange, 'unchanged');
  assert.equal(targetReference.targetChange.remoteChange, 'update');
  assertBlockerHasHashOnlyChanges(blocker);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(evidence.invariants, {
    planBlocked: true,
    graphIdentityBlocker: true,
    targetReferencePresent: true,
    noBlockedResourceMutation: true,
    refusedBeforeMutation: true,
  });
  assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
});

test('RPP-0350 unsupported nav_menu taxonomy evidence fails closed before mutation', () => {
  const fixture = unsupportedNavMenuTaxonomyFixture();
  const plan = planFor(fixture.base, fixture.local, fixture.remote);
  const taxonomyBlocker = blockerFor(plan, fixture.taxonomyResourceKey);
  const relationshipBlocker = blockerFor(plan, fixture.relationshipResourceKey);
  const relationshipReference = relationshipBlocker?.references.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const evidence = unsupportedTaxonomyReferenceEvidence({
    fixture,
    plan,
    taxonomyBlocker,
    relationshipBlocker,
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, fixture.taxonomyResourceKey), undefined);
  assert.equal(mutationFor(plan, fixture.relationshipResourceKey), undefined);
  assert.ok(taxonomyBlocker, 'missing unsupported nav_menu taxonomy blocker');
  assert.equal(taxonomyBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(taxonomyBlocker.reason, /unsupported taxonomy graph surface nav_menu/);
  assert.ok(relationshipBlocker, 'missing unsupported nav_menu relationship blocker');
  assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(relationshipReference, 'missing unsupported relationship target evidence');
  assert.equal(relationshipReference.targetResourceKey, fixture.taxonomyResourceKey);
  assert.deepEqual(relationshipReference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${fixture.taxonomyResourceKey} references unsupported taxonomy graph surface nav_menu.`,
  });
  assertBlockerHasHashOnlyChanges(taxonomyBlocker);
  assertBlockerHasHashOnlyChanges(relationshipBlocker);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(evidence.invariants, {
    planBlocked: true,
    taxonomyBlocked: true,
    relationshipBlocked: true,
    noTaxonomyMutation: true,
    noRelationshipMutation: true,
    relationshipTargetSupportFailed: true,
    refusedBeforeMutation: true,
  });
  assertHashOnlyGraphEvidence(evidence, fixture.rawFixtureSentinels);
});

test('RPP-0350 evidence document labels unmapped surfaces and NO-GO release posture', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0350 post_tag taxonomy reference v3 evidence$/m);
  assert.match(evidenceDoc, /local support evidence/i);
  assert.match(evidenceDoc, /Final release posture: `NO-GO`/);
  assert.match(evidenceDoc, /hash-only graph evidence/i);
  assert.match(evidenceDoc, /^## Remaining unmapped WordPress surfaces$/m);
  assert.match(evidenceDoc, /`post_tag` is covered by this local support proof/);
  for (const documentedSurface of [
    '`wp_term_taxonomy.taxonomy = nav_menu`',
    'Custom/plugin taxonomy rows without an explicit equivalent identity-map target',
    '`wp_posts.post_type = nav_menu_item`',
    '`wp_navigation`',
    'Serialized block references',
  ]) {
    assert.ok(
      evidenceDoc.includes(documentedSurface),
      `missing documented surface: ${documentedSurface}`,
    );
  }
});

function mappedPostTagFixture() {
  const postId = 350001;
  const sourceTermId = 350101;
  const targetTermId = 350201;
  const sourceTaxonomyId = 350111;
  const targetTaxonomyId = 350211;
  const base = baseSite({ postId, title: 'RPP-0350 mapped base post' });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_terms', localId: `term_id:${sourceTermId}`, remoteId: `term_id:${targetTermId}` },
        {
          table: 'wp_term_taxonomy',
          localId: `term_taxonomy_id:${sourceTaxonomyId}`,
          remoteId: `term_taxonomy_id:${targetTaxonomyId}`,
        },
      ],
    },
  };
  local.db.wp_terms[`term_id:${sourceTermId}`] = postTagTerm({
    termId: sourceTermId,
    name: 'RPP-0350 Mapped Post Tag Term',
    slug: 'rpp-0350-mapped-post-tag-term',
  });
  remote.db.wp_terms[`term_id:${targetTermId}`] = postTagTerm({
    termId: targetTermId,
    name: 'RPP-0350 Mapped Post Tag Term',
    slug: 'rpp-0350-mapped-post-tag-term',
  });
  local.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTaxonomyId}`] = postTagTaxonomy({
    termTaxonomyId: sourceTaxonomyId,
    termId: sourceTermId,
    description: 'rpp-0350 mapped post_tag description',
  });
  remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`] = postTagTaxonomy({
    termTaxonomyId: targetTaxonomyId,
    termId: targetTermId,
    description: 'rpp-0350 mapped post_tag description',
  });
  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${sourceTaxonomyId}`] = {
    object_id: postId,
    term_taxonomy_id: sourceTaxonomyId,
    term_order: 0,
  };

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
      'RPP-0350 Mapped Post Tag Term',
      'rpp-0350-mapped-post-tag-term',
      'rpp-0350 mapped post_tag description',
    ],
  };
}

function stablePostTagFixture() {
  const postId = 350301;
  const termId = 350401;
  const termTaxonomyId = 350411;
  const base = baseSite({ postId, title: 'RPP-0350 stable base post' });
  base.db.wp_terms[`term_id:${termId}`] = postTagTerm({
    termId,
    name: 'RPP-0350 Stable Post Tag Term',
    slug: 'rpp-0350-stable-post-tag-term',
  });
  base.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`] = postTagTaxonomy({
    termTaxonomyId,
    termId,
    description: 'rpp-0350 stable post_tag description',
  });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`] = {
    object_id: postId,
    term_taxonomy_id: termTaxonomyId,
    term_order: 0,
  };

  return {
    base,
    local,
    remote,
    postId,
    termId,
    termTaxonomyId,
    taxonomyResourceKey: rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${termTaxonomyId}`),
    relationshipResourceKey: rowResourceKey(
      'wp_term_relationships',
      `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`,
    ),
    rawFixtureSentinels: [
      'RPP-0350 Stable Post Tag Term',
      'rpp-0350-stable-post-tag-term',
      'rpp-0350 stable post_tag description',
    ],
  };
}

function stalePostTagFixture() {
  const fixture = stablePostTagFixture();
  fixture.remote.db.wp_term_taxonomy[`term_taxonomy_id:${fixture.termTaxonomyId}`] = postTagTaxonomy({
    termTaxonomyId: fixture.termTaxonomyId,
    termId: fixture.termId,
    description: 'rpp-0350 remote stale post_tag description',
  });

  return {
    ...fixture,
    rawFixtureSentinels: [
      ...fixture.rawFixtureSentinels,
      'rpp-0350 remote stale post_tag description',
    ],
  };
}

function unsupportedNavMenuTaxonomyFixture() {
  const postId = 350501;
  const termId = 350601;
  const termTaxonomyId = 350611;
  const base = baseSite({ postId, title: 'RPP-0350 unsupported taxonomy base post' });
  base.db.wp_terms[`term_id:${termId}`] = postTagTerm({
    termId,
    name: 'RPP-0350 Unsupported Nav Menu Term',
    slug: 'rpp-0350-unsupported-nav-menu-term',
  });
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`] = {
    term_taxonomy_id: termTaxonomyId,
    term_id: termId,
    taxonomy: 'nav_menu',
    description: 'rpp-0350 unsupported nav_menu taxonomy description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships[`object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`] = {
    object_id: postId,
    term_taxonomy_id: termTaxonomyId,
    term_order: 0,
  };

  return {
    base,
    local,
    remote,
    postId,
    termId,
    termTaxonomyId,
    taxonomyResourceKey: rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${termTaxonomyId}`),
    relationshipResourceKey: rowResourceKey(
      'wp_term_relationships',
      `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`,
    ),
    rawFixtureSentinels: [
      'RPP-0350 Unsupported Nav Menu Term',
      'rpp-0350-unsupported-nav-menu-term',
      'rpp-0350 unsupported nav_menu taxonomy description',
    ],
  };
}

function mappedPostTagTaxonomyReferenceEvidence({ fixture, plan, applied }) {
  const sourceTermDecision = decisionFor(plan, fixture.sourceTermResourceKey);
  const sourceTaxonomyDecision = decisionFor(plan, fixture.sourceTaxonomyResourceKey);
  const targetTaxonomyDecision = decisionFor(plan, fixture.targetTaxonomyResourceKey);
  const relationshipMutation = mutationFor(plan, fixture.rewrittenRelationshipResourceKey);
  const relationshipPrecondition = preconditionFor(plan, relationshipMutation);
  const relationshipValue = deserializeResourceValue(relationshipMutation?.value);
  const rewrite = relationshipMutation?.wordpressGraphIdentity?.rewrites?.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const targetTaxonomyResource = rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.targetTaxonomyId}`);
  const sourceRelationshipMutation = mutationFor(plan, fixture.sourceRelationshipResourceKey);
  const appliedRelationshipHash = resourceHash(
    applied.site,
    rowResource('wp_term_relationships', `object_id:${fixture.postId}|term_taxonomy_id:${fixture.targetTaxonomyId}`),
  );
  const appliedTargetTaxonomyHash = resourceHash(applied.site, targetTaxonomyResource);
  const remoteTargetTaxonomyHash = resourceHash(fixture.remote, targetTaxonomyResource);
  const invariants = {
    planReady: plan.status === 'ready',
    sourceTermMapped: sourceTermDecision?.decision === 'map-local-identity-to-remote',
    sourceTaxonomyMapped: sourceTaxonomyDecision?.decision === 'map-local-identity-to-remote'
      && sourceTaxonomyDecision?.targetResourceKey === fixture.targetTaxonomyResourceKey,
    targetTermTaxonomyPreserved: targetTaxonomyDecision?.decision === 'keep-remote'
      && appliedTargetTaxonomyHash === remoteTargetTaxonomyHash,
    relationshipRewrittenToTarget: relationshipValue?.term_taxonomy_id === fixture.targetTaxonomyId
      && rewrite?.sourceTargetResourceKey === fixture.sourceTaxonomyResourceKey
      && rewrite?.targetResourceKey === fixture.targetTaxonomyResourceKey,
    livePrecondition: relationshipPrecondition?.checkedAgainst === 'live-remote'
      && relationshipPrecondition?.expectedHash === relationshipMutation?.remoteBeforeHash,
    applyCarriedTarget: appliedRelationshipHash === relationshipMutation?.localHash,
    noSourceRelationshipMutation: sourceRelationshipMutation === undefined,
  };
  const proof = {
    target: 'postTagTaxonomyReferenceVariant3',
    variant: 'ready-identity-map-rewrite',
    evidenceScope: 'local-graph-identity-apply-shaped',
    productionBacked: false,
    releaseGate: 'NO-GO',
    resourceKeys: {
      sourceTerm: fixture.sourceTermResourceKey,
      targetTerm: fixture.targetTermResourceKey,
      sourceTermTaxonomy: fixture.sourceTaxonomyResourceKey,
      targetTermTaxonomy: fixture.targetTaxonomyResourceKey,
      sourceRelationship: fixture.sourceRelationshipResourceKey,
      rewrittenRelationship: fixture.rewrittenRelationshipResourceKey,
    },
    taxonomy: 'post_tag',
    identityMap: {
      sourceTermDecision: sourceTermDecision?.decision || null,
      sourceTaxonomyDecision: sourceTaxonomyDecision?.decision || null,
      targetTaxonomyDecision: targetTaxonomyDecision?.decision || null,
      sourceTermDecisionHash: `sha256:${digest(sourceTermDecision)}`,
      sourceTaxonomyDecisionHash: `sha256:${digest(sourceTaxonomyDecision)}`,
      targetTaxonomyDecisionHash: `sha256:${digest(targetTaxonomyDecision)}`,
    },
    relationship: {
      relationshipKey: rewrite?.relationshipKey || null,
      relationshipType: rewrite?.relationshipType || null,
      field: rewrite?.field || null,
      plannedTermTaxonomyId: Number(relationshipValue?.term_taxonomy_id),
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

function stablePostTagTaxonomyReferenceEvidence({ fixture, plan, applied }) {
  const relationshipMutation = mutationFor(plan, fixture.relationshipResourceKey);
  const relationshipPrecondition = preconditionFor(plan, relationshipMutation);
  const relationshipValue = deserializeResourceValue(relationshipMutation?.value);
  const taxonomyResource = rowResource('wp_term_taxonomy', `term_taxonomy_id:${fixture.termTaxonomyId}`);
  const relationshipResource = rowResource(
    'wp_term_relationships',
    `object_id:${fixture.postId}|term_taxonomy_id:${fixture.termTaxonomyId}`,
  );
  const baseTaxonomyHash = resourceHash(fixture.base, taxonomyResource);
  const localTaxonomyHash = resourceHash(fixture.local, taxonomyResource);
  const remoteTaxonomyHash = resourceHash(fixture.remote, taxonomyResource);
  const appliedTaxonomyHash = resourceHash(applied.site, taxonomyResource);
  const appliedRelationshipHash = resourceHash(applied.site, relationshipResource);
  const invariants = {
    planReady: plan.status === 'ready',
    mutationPresent: Boolean(relationshipMutation),
    noIdentityRewrite: relationshipMutation?.wordpressGraphIdentity === undefined,
    termTaxonomyStable: baseTaxonomyHash === localTaxonomyHash
      && localTaxonomyHash === remoteTaxonomyHash
      && remoteTaxonomyHash === appliedTaxonomyHash,
    relationshipCarriesStableTarget: Number(relationshipValue?.term_taxonomy_id) === fixture.termTaxonomyId,
    livePrecondition: relationshipPrecondition?.checkedAgainst === 'live-remote'
      && relationshipPrecondition?.expectedHash === relationshipMutation?.remoteBeforeHash,
    applyCarriedTarget: appliedRelationshipHash === relationshipMutation?.localHash,
  };
  const proof = {
    target: 'postTagTaxonomyReferenceVariant3',
    variant: 'ready-stable-term-taxonomy-identity',
    evidenceScope: 'local-graph-identity-apply-shaped',
    productionBacked: false,
    releaseGate: 'NO-GO',
    resourceKeys: {
      termTaxonomy: fixture.taxonomyResourceKey,
      relationship: fixture.relationshipResourceKey,
    },
    taxonomy: 'post_tag',
    relationship: {
      relationshipKey: 'wp_term_relationships.term_taxonomy_id',
      relationshipType: 'term-relationship-taxonomy',
      plannedTermTaxonomyId: Number(relationshipValue?.term_taxonomy_id),
    },
    hashes: {
      termTaxonomyBase: baseTaxonomyHash,
      termTaxonomyLocal: localTaxonomyHash,
      termTaxonomyRemote: remoteTaxonomyHash,
      termTaxonomyApplied: appliedTaxonomyHash,
      relationshipRemoteBefore: relationshipMutation?.remoteBeforeHash || null,
      relationshipPrecondition: relationshipPrecondition?.expectedHash || null,
      relationshipPlannedLocal: relationshipMutation?.localHash || null,
      relationshipApplied: appliedRelationshipHash,
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

function blockedPostTagTaxonomyEvidence({ fixture, plan, blocker, variant }) {
  const targetReference = blocker?.references.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(fixture.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  const invariants = {
    planBlocked: plan.status === 'blocked',
    graphIdentityBlocker: blocker?.class === 'stale-wordpress-graph-identity',
    targetReferencePresent: targetReference?.targetResourceKey === fixture.taxonomyResourceKey,
    noBlockedResourceMutation: mutationFor(plan, blocker?.resourceKey) === undefined,
    refusedBeforeMutation: remoteBeforeHash === remoteAfterHash,
  };
  const proof = {
    target: 'postTagTaxonomyReferenceVariant3',
    variant,
    evidenceScope: 'local-graph-identity-fail-closed',
    productionBacked: false,
    releaseGate: 'NO-GO',
    resourceKey: blocker?.resourceKey || null,
    class: blocker?.class || null,
    resolutionPolicy: blocker?.resolutionPolicy || null,
    relationship: {
      relationshipKey: targetReference?.relationshipKey || null,
      relationshipType: targetReference?.relationshipType || null,
      targetResourceKey: targetReference?.targetResourceKey || null,
      targetLocalChange: targetReference?.targetChange?.localChange || null,
      targetRemoteChange: targetReference?.targetChange?.remoteChange || null,
    },
    hashes: {
      blockerBase: blocker?.baseHash || null,
      blockerLocal: blocker?.localHash || null,
      blockerRemote: blocker?.remoteHash || null,
      blockerChangeBase: blocker?.change?.base?.hash || null,
      blockerChangeLocal: blocker?.change?.local?.hash || null,
      blockerChangeRemote: blocker?.change?.remote?.hash || null,
      targetBase: targetReference?.targetBaseHash || null,
      targetLocal: targetReference?.targetLocalHash || null,
      targetRemote: targetReference?.targetRemoteHash || null,
      targetChangeBase: targetReference?.targetChange?.base?.hash || null,
      targetChangeLocal: targetReference?.targetChange?.local?.hash || null,
      targetChangeRemote: targetReference?.targetChange?.remote?.hash || null,
      remoteBefore: remoteBeforeHash,
      remoteAfter: remoteAfterHash,
      details: `sha256:${digest(error.details)}`,
    },
    refusal: {
      code: error.code,
    },
    release: {
      productionBacked: false,
      finalRecommendation: 'NO-GO',
      caveat: 'local-support-evidence-only',
    },
    invariants,
  };

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');

  return {
    ...proof,
    ok: Object.values(invariants).every(Boolean),
    proofHash: `sha256:${digest(proof)}`,
  };
}

function unsupportedTaxonomyReferenceEvidence({
  fixture,
  plan,
  taxonomyBlocker,
  relationshipBlocker,
}) {
  const relationshipReference = relationshipBlocker?.references.find((entry) =>
    entry.relationshipType === 'term-relationship-taxonomy');
  const remoteBefore = cloneJson(fixture.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  const invariants = {
    planBlocked: plan.status === 'blocked',
    taxonomyBlocked: taxonomyBlocker?.class === 'stale-wordpress-graph-identity',
    relationshipBlocked: relationshipBlocker?.class === 'stale-wordpress-graph-identity',
    noTaxonomyMutation: mutationFor(plan, fixture.taxonomyResourceKey) === undefined,
    noRelationshipMutation: mutationFor(plan, fixture.relationshipResourceKey) === undefined,
    relationshipTargetSupportFailed: relationshipReference?.targetSupport?.className === 'stale-wordpress-graph-identity',
    refusedBeforeMutation: remoteBeforeHash === remoteAfterHash,
  };
  const proof = {
    target: 'postTagTaxonomyReferenceVariant3',
    variant: 'unsupported-nav-menu-taxonomy-target',
    evidenceScope: 'local-graph-identity-fail-closed',
    productionBacked: false,
    releaseGate: 'NO-GO',
    resourceKeys: {
      termTaxonomy: fixture.taxonomyResourceKey,
      relationship: fixture.relationshipResourceKey,
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
      details: `sha256:${digest(error.details)}`,
    },
    refusal: {
      code: error.code,
    },
    release: {
      productionBacked: false,
      finalRecommendation: 'NO-GO',
      caveat: 'local-support-evidence-only',
    },
    invariants,
  };

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');

  return {
    ...proof,
    ok: Object.values(invariants).every(Boolean),
    proofHash: `sha256:${digest(proof)}`,
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
      fixture: 'rpp-0350-post-tag-taxonomy-reference-v3',
    },
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${postId}`]: {
          ID: postId,
          post_title: title,
          post_name: `rpp-0350-post-${postId}`,
          post_content: 'RPP-0350 taxonomy anchor post.',
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

function postTagTerm({ termId, name, slug }) {
  return {
    term_id: termId,
    name,
    slug,
    term_group: 0,
  };
}

function postTagTaxonomy({ termTaxonomyId, termId, description }) {
  return {
    term_taxonomy_id: termTaxonomyId,
    term_id: termId,
    taxonomy: 'post_tag',
    description,
    parent: 0,
    count: 1,
  };
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

function assertBlockerHasHashOnlyChanges(blocker) {
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

function assertHashOnlyGraphEvidence(evidence, rawFixtureSentinels) {
  assertNoPayloadKeys(evidence);
  for (const hash of collectHashFields(evidence)) {
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
}

function assertNoPayloadKeys(value) {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.notEqual(key, 'value', 'hash-only graph evidence must not include raw value payloads');
    assert.notEqual(key, 'rawValue', 'hash-only graph evidence must not include rawValue payloads');
    assertNoPayloadKeys(nested);
  }
}

function collectHashFields(value) {
  const hashes = [];
  collectHashFieldsInto(value, hashes);
  return hashes;
}

function collectHashFieldsInto(value, hashes) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectHashFieldsInto(entry, hashes);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/hash/i.test(key) && typeof nested === 'string') {
      hashes.push(nested);
    }
    collectHashFieldsInto(nested, hashes);
  }
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
