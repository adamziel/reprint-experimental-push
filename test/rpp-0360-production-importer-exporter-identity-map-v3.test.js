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
  'docs/evidence/rpp-0360-production-importer-exporter-identity-map-v3.md',
);
const fixedGeneratedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const mapSource = 'base-snapshot.meta.identityMap[2].resources[0]';
const generatedFamily = 'production-importer-exporter-identity-map-v3';
const generatedTarget = 'productionImporterExporterIdentityMapVariant3';
const remainingUnmappedSurfaces = Object.freeze([
  'wp_posts.post_type=nav_menu_item',
  'wp_posts.post_type=revision',
  'wp_posts.post_type=wp_navigation',
  'menu-item-graph-metadata',
  'wp_term_taxonomy.taxonomy=nav_menu',
  'nav-menu-term-relationships',
  'custom-plugin-taxonomies-without-explicit-map',
  'serialized-block-references-in-post-content',
  'unsupported-identity-map-table-surfaces',
  'stale-missing-ambiguous-non-equivalent-imported-targets',
]);
const expectedDocSurfaceSnippets = Object.freeze([
  'wp_posts.post_type = nav_menu_item',
  'wp_posts.post_type = revision',
  'wp_navigation',
  '_menu_item_object',
  'wp_term_taxonomy.taxonomy = nav_menu',
  'wp_term_relationships',
  'custom/plugin taxonomy',
  'serialized block references',
  'unsupported table',
  'stale, missing, ambiguous, or non-equivalent imported targets',
]);

function baseSite(meta = {}) {
  return {
    meta,
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {},
      wp_postmeta: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function generatedCases() {
  const cases = [];
  for (let tier = 0; tier < 10; tier += 1) {
    cases.push(generatedCase({ tier, staleTarget: false }));
    cases.push(generatedCase({ tier, staleTarget: true }));
  }
  return cases;
}

function generatedCase({ tier, staleTarget }) {
  const sourceParentId = 736000 + tier * 100 + 1;
  const sourceChildId = sourceParentId + 1;
  const importedTargetId = sourceParentId + 50;
  const metaKey = `_rpp_0360_importer_exporter_map_t${tier}`;
  const sourceParentRowId = `ID:${sourceParentId}`;
  const sourceChildRowId = `ID:${sourceChildId}`;
  const importedTargetRowId = `ID:${importedTargetId}`;
  const sourcePostmetaRowId = `post_id:${sourceParentId}:meta_key:${metaKey}`;
  const importedPostmetaRowId = `post_id:${importedTargetId}:meta_key:${metaKey}`;
  const resources = {
    sourceParent: rowResource('wp_posts', sourceParentRowId),
    sourceChild: rowResource('wp_posts', sourceChildRowId),
    importedTarget: rowResource('wp_posts', importedTargetRowId),
    sourcePostmeta: rowResource('wp_postmeta', sourcePostmetaRowId),
    importedPostmeta: rowResource('wp_postmeta', importedPostmetaRowId),
  };
  const privateValues = {
    parentTitle: `RPP-0360 generated importer exporter parent ${tier}`,
    parentSlug: `rpp-0360-generated-importer-exporter-parent-${tier}`,
    parentBody: `rpp0360-generated-parent-private-body-${tier}`,
    childTitle: `RPP-0360 generated importer exporter child ${tier}`,
    childSlug: `rpp-0360-generated-importer-exporter-child-${tier}`,
    childBody: `rpp0360-generated-child-private-body-${tier}`,
    metaValue: `rpp0360-generated-postmeta-private-value-${tier}`,
    staleTitle: `RPP-0360 stale imported target ${tier}`,
    staleBody: `rpp0360-stale-imported-target-private-body-${tier}`,
  };
  const sourceParentRow = {
    ID: sourceParentId,
    post_title: privateValues.parentTitle,
    post_name: privateValues.parentSlug,
    post_content: privateValues.parentBody,
    post_status: 'publish',
    post_type: 'page',
    post_parent: 0,
    post_author: 0,
  };
  const sourceChildRow = {
    ID: sourceChildId,
    post_title: privateValues.childTitle,
    post_name: privateValues.childSlug,
    post_content: privateValues.childBody,
    post_status: 'publish',
    post_type: 'page',
    post_parent: sourceParentId,
    post_author: 0,
  };
  const importedTargetRow = {
    ...sourceParentRow,
    ID: importedTargetId,
    post_title: staleTarget ? privateValues.staleTitle : privateValues.parentTitle,
    post_content: staleTarget ? privateValues.staleBody : privateValues.parentBody,
  };
  const base = baseSite({
    pushIdentityMap: {
      provenance: {
        exporter: {
          artifactHash: digest({ rpp: 'RPP-0360', tier, side: 'exporter-artifact' }),
          rowCount: 1,
          observedAt: '2026-05-31T00:00:00.000Z',
        },
        importer: {
          packageHash: digest({ rpp: 'RPP-0360', tier, side: 'importer-package' }),
          persistedAt: '2026-05-31T00:01:00.000Z',
          immutableBase: true,
        },
      },
      resources: [
        {
          sourceResourceKey: resources.sourceParent.key,
          targetResourceKey: resources.importedTarget.key,
        },
      ],
    },
  });
  const local = baseSite();
  const remote = baseSite();

  local.db.wp_posts[sourceParentRowId] = sourceParentRow;
  local.db.wp_posts[sourceChildRowId] = sourceChildRow;
  local.db.wp_postmeta[sourcePostmetaRowId] = {
    post_id: sourceParentId,
    meta_key: metaKey,
    meta_value: privateValues.metaValue,
  };
  remote.db.wp_posts[importedTargetRowId] = importedTargetRow;

  return {
    id: `rpp-0360-tier-${tier}-${staleTarget ? 'stale' : 'ready'}`,
    tier,
    statusTag: staleTarget ? 'stale-imported-target' : 'ready-imported-target',
    staleTarget,
    base,
    local,
    remote,
    ids: {
      sourceParentId,
      sourceChildId,
      importedTargetId,
      sourceParentRowId,
      sourceChildRowId,
      importedTargetRowId,
      sourcePostmetaRowId,
      importedPostmetaRowId,
      metaKey,
    },
    resources,
    rawValues: Object.values(privateValues),
  };
}

function createGeneratedPlan(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedNow,
  });
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
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation?.id);
}

function rewriteFor(mutation, relationshipType) {
  return mutation?.wordpressGraphIdentity?.rewrites?.find((rewrite) =>
    rewrite.relationshipType === relationshipType);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertLiveRemotePreconditions(plan) {
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing live-remote precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function assertHashOnlyBlockerEvidence(blocker) {
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
  assert.equal(Object.hasOwn(blocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.remote, 'value'), false);

  for (const reference of blocker.references || []) {
    for (const hash of [
      reference.targetBaseHash,
      reference.targetLocalHash,
      reference.targetRemoteHash,
      reference.targetChange?.base?.hash,
      reference.targetChange?.local?.hash,
      reference.targetChange?.remote?.hash,
    ].filter(Boolean)) {
      assert.match(hash, hashPattern);
    }
    if (reference.targetChange) {
      assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
      assert.equal(Object.hasOwn(reference.targetChange.remote, 'value'), false);
    }
  }
}

function assertNoRawValues(evidence, rawValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked raw value ${rawValue}`);
  }
}

function readyCaseEvidence(testCase, plan) {
  const { ids, resources } = testCase;
  const sourceDecision = decisionFor(plan, resources.sourceParent.key);
  const targetDecision = decisionFor(plan, resources.importedTarget.key);
  const childMutation = mutationFor(plan, resources.sourceChild.key);
  const postmetaMutation = mutationFor(plan, resources.importedPostmeta.key);
  const childPrecondition = preconditionFor(plan, childMutation);
  const postmetaPrecondition = preconditionFor(plan, postmetaMutation);
  const childRewrite = rewriteFor(childMutation, 'post-parent');
  const postmetaRewrite = rewriteFor(postmetaMutation, 'postmeta-post');
  const plannedChild = deserializeResourceValue(childMutation?.value);
  const plannedPostmeta = deserializeResourceValue(postmetaMutation?.value);
  const applied = applyPlan(cloneJson(testCase.remote), plan).site;

  assert.equal(testCase.base.meta.pushIdentityMap.provenance.importer.immutableBase, true);
  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(plan.mutations.length, 2, `${testCase.id} should plan only rewritten dependents`);
  assert.equal(sourceDecision?.decision, 'map-local-identity-to-remote');
  assert.equal(sourceDecision.identityMapSource, mapSource);
  assert.equal(sourceDecision.targetResourceKey, resources.importedTarget.key);
  assert.equal(targetDecision?.decision, 'keep-remote');
  assert.equal(mutationFor(plan, resources.sourceParent.key), undefined);
  assert.equal(mutationFor(plan, resources.sourcePostmeta.key), undefined);
  assert.ok(childMutation, `${testCase.id} should plan rewritten child page`);
  assert.ok(postmetaMutation, `${testCase.id} should plan rewritten imported-target postmeta`);
  assert.ok(childPrecondition, `${testCase.id} should precondition child mutation`);
  assert.ok(postmetaPrecondition, `${testCase.id} should precondition postmeta mutation`);

  assert.equal(plannedChild.post_parent, ids.importedTargetId);
  assert.equal(childRewrite.relationshipKey, 'wp_posts.post_parent');
  assert.equal(childRewrite.sourceResourceKey, resources.sourceChild.key);
  assert.equal(childRewrite.sourceTargetResourceKey, resources.sourceParent.key);
  assert.equal(childRewrite.targetResourceKey, resources.importedTarget.key);
  assert.equal(childRewrite.identityMapSource, mapSource);
  assert.match(childRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(childRewrite.targetRemoteHash, hashPattern);

  assert.equal(plannedPostmeta.post_id, ids.importedTargetId);
  assert.equal(plannedPostmeta.meta_key, ids.metaKey);
  assert.equal(postmetaRewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(postmetaRewrite.sourceResourceKey, resources.sourcePostmeta.key);
  assert.equal(postmetaRewrite.rewrittenResourceKey, resources.importedPostmeta.key);
  assert.equal(postmetaRewrite.sourceTargetResourceKey, resources.sourceParent.key);
  assert.equal(postmetaRewrite.targetResourceKey, resources.importedTarget.key);
  assert.equal(postmetaRewrite.identityMapSource, mapSource);
  assert.match(postmetaRewrite.sourceTargetLocalHash, hashPattern);
  assert.match(postmetaRewrite.targetRemoteHash, hashPattern);
  assertLiveRemotePreconditions(plan);

  assert.equal(applied.db.wp_posts[ids.sourceParentRowId], undefined);
  assert.deepEqual(applied.db.wp_posts[ids.importedTargetRowId], testCase.remote.db.wp_posts[ids.importedTargetRowId]);
  assert.equal(applied.db.wp_posts[ids.sourceChildRowId].post_parent, ids.importedTargetId);
  assert.equal(applied.db.wp_postmeta[ids.importedPostmetaRowId].post_id, ids.importedTargetId);

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    variant: 'ready-imported-target',
    status: plan.status,
    planSummary: plan.summary,
    identityMap: {
      mapAlias: 'pushIdentityMap',
      mapSource,
      mapRowsHash: `sha256:${digest(testCase.base.meta.pushIdentityMap.resources)}`,
      exporterProvenanceHash: `sha256:${digest(testCase.base.meta.pushIdentityMap.provenance.exporter)}`,
      importerProvenanceHash: `sha256:${digest(testCase.base.meta.pushIdentityMap.provenance.importer)}`,
      sourceResourceKey: resources.sourceParent.key,
      targetResourceKey: resources.importedTarget.key,
      sourceDecision: sourceDecision.decision,
      targetDecision: targetDecision.decision,
      sourceDecisionHash: `sha256:${digest(sourceDecision)}`,
      targetDecisionHash: `sha256:${digest(targetDecision)}`,
    },
    dependentRewrites: [
      readyMutationEvidence({
        mutation: childMutation,
        precondition: childPrecondition,
        rewrite: childRewrite,
        plannedField: { field: 'post_parent', plannedScalar: plannedChild.post_parent },
      }),
      readyMutationEvidence({
        mutation: postmetaMutation,
        precondition: postmetaPrecondition,
        rewrite: postmetaRewrite,
        plannedField: { field: 'post_id', plannedScalar: plannedPostmeta.post_id },
      }),
    ],
    appliedEvidence: {
      sourceAbsentAfterApply: applied.db.wp_posts[ids.sourceParentRowId] === undefined,
      targetPostHashBefore: resourceHash(testCase.remote, resources.importedTarget),
      targetPostHashAfter: resourceHash(applied, resources.importedTarget),
      childPostHashAfter: resourceHash(applied, resources.sourceChild),
      postmetaHashAfter: resourceHash(applied, resources.importedPostmeta),
      childPostParent: applied.db.wp_posts[ids.sourceChildRowId].post_parent,
      postmetaPostId: applied.db.wp_postmeta[ids.importedPostmetaRowId].post_id,
      targetRemotePreserved: digest(applied.db.wp_posts[ids.importedTargetRowId])
        === digest(testCase.remote.db.wp_posts[ids.importedTargetRowId]),
    },
  };
  evidence.proofHash = `sha256:${digest(evidence)}`;
  assertNoRawValues(evidence, testCase.rawValues, testCase.id);
  return evidence;
}

function readyMutationEvidence({ mutation, precondition, rewrite, plannedField }) {
  return {
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    plannedField,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    liveRemotePrecondition: precondition.expectedHash === mutation.remoteBeforeHash,
    rewrite: {
      relationshipKey: rewrite.relationshipKey,
      relationshipType: rewrite.relationshipType,
      sourceResourceKey: rewrite.sourceResourceKey,
      rewrittenResourceKey: rewrite.rewrittenResourceKey,
      sourceTargetResourceKey: rewrite.sourceTargetResourceKey,
      targetResourceKey: rewrite.targetResourceKey,
      identityMapSource: rewrite.identityMapSource,
      sourceTargetLocalHash: rewrite.sourceTargetLocalHash,
      targetRemoteHash: rewrite.targetRemoteHash,
      rewriteHash: `sha256:${digest(rewrite)}`,
    },
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      plannedField,
    })}`,
  };
}

function staleCaseEvidence(testCase, plan) {
  const { resources } = testCase;
  const sourceBlocker = blockerFor(plan, resources.sourceParent.key);
  const childBlocker = blockerFor(plan, resources.sourceChild.key);
  const postmetaBlocker = blockerFor(plan, resources.sourcePostmeta.key);
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  const serializedBlockers = JSON.stringify(plan.blockers);

  assert.equal(plan.status, 'blocked', `${testCase.id} should block stale imported target`);
  assert.equal(plan.mutations.length, 0, `${testCase.id} should not plan stale imported target mutations`);
  assert.ok(sourceBlocker, `${testCase.id} missing source stale identity-map blocker`);
  assert.equal(sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.match(sourceBlocker.reason, /not equivalent after identity rewriting/);
  assert.ok(childBlocker, `${testCase.id} missing child blocker`);
  assert.equal(childBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(postmetaBlocker, `${testCase.id} missing postmeta blocker`);
  assert.equal(postmetaBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(childBlocker.references.some((reference) =>
    reference.relationshipType === 'post-parent'
    && reference.targetResourceKey === resources.sourceParent.key
    && reference.targetSupport?.className === 'stale-wordpress-graph-identity'));
  assert.ok(postmetaBlocker.references.some((reference) =>
    reference.relationshipType === 'postmeta-post'
    && reference.targetResourceKey === resources.sourceParent.key
    && reference.targetSupport?.className === 'stale-wordpress-graph-identity'));

  for (const blocker of [sourceBlocker, childBlocker, postmetaBlocker]) {
    assertHashOnlyBlockerEvidence(blocker);
  }
  for (const rawValue of testCase.rawValues) {
    assert.equal(serializedBlockers.includes(rawValue), false, `${testCase.id} blocker leaked ${rawValue}`);
  }
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale plan mutated remote`);

  const evidence = {
    id: testCase.id,
    tier: testCase.tier,
    variant: 'stale-imported-target',
    status: plan.status,
    planSummary: plan.summary,
    staleTarget: {
      sourceResourceKey: resources.sourceParent.key,
      targetResourceKey: resources.importedTarget.key,
      sourceLocalHash: resourceHash(testCase.local, resources.sourceParent),
      targetRemoteHash: resourceHash(testCase.remote, resources.importedTarget),
      mapRowsHash: `sha256:${digest(testCase.base.meta.pushIdentityMap.resources)}`,
    },
    blockers: [sourceBlocker, childBlocker, postmetaBlocker].map(staleBlockerEvidence),
    refusal: {
      code: error.code,
      remoteBeforeHash,
      remoteAfterHash,
      refusedBeforeMutation: remoteAfterHash === remoteBeforeHash,
    },
  };
  evidence.proofHash = `sha256:${digest(evidence)}`;
  assertNoRawValues(evidence, testCase.rawValues, testCase.id);
  return evidence;
}

function staleBlockerEvidence(blocker) {
  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    resolutionPolicy: blocker.resolutionPolicy,
    reasonHash: `sha256:${digest(blocker.reason || '')}`,
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
    changeHash: `sha256:${digest(blocker.change)}`,
    references: (blocker.references || []).map((reference) => ({
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      sourceResourceKey: reference.sourceResourceKey,
      targetResourceKey: reference.targetResourceKey,
      identityMapSource: reference.identityMapSource || null,
      targetSupportClass: reference.targetSupport?.className || reference.className || null,
      targetBaseHash: reference.targetBaseHash || null,
      targetLocalHash: reference.targetLocalHash || null,
      targetRemoteHash: reference.targetRemoteHash || null,
      targetChangeHash: reference.targetChange ? `sha256:${digest(reference.targetChange)}` : null,
      referenceHash: `sha256:${digest(reference)}`,
    })),
    blockerHash: `sha256:${digest({
      resourceKey: blocker.resourceKey,
      class: blocker.class,
      resolutionPolicy: blocker.resolutionPolicy,
      change: blocker.change,
      references: blocker.references,
    })}`,
  };
}

function generatedCaseEvidence(testCase) {
  const plan = createGeneratedPlan(testCase);
  return testCase.staleTarget
    ? staleCaseEvidence(testCase, plan)
    : readyCaseEvidence(testCase, plan);
}

function buildAggregateEvidence() {
  const cases = generatedCases();
  const caseProofs = cases.map(generatedCaseEvidence);
  const perTier = {};
  const statuses = {};

  for (const proof of caseProofs) {
    incrementCount(perTier, proof.tier);
    incrementCount(statuses, proof.status);
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const readyProofs = caseProofs.filter((entry) => entry.status === 'ready');
  const staleProofs = caseProofs.filter((entry) => entry.status === 'blocked');
  const aggregateEvidence = {
    rpp: 'RPP-0360',
    successText: 'docs state remaining unmapped WordPress surfaces',
    status: 'support_only',
    evidenceSource: 'generated-production-importer-exporter-identity-map-v3',
    evidenceScope: 'local-deterministic-generated-fixtures',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    mapAlias: 'pushIdentityMap',
    mapSource,
    coverage: {
      target: generatedTarget,
      family: generatedFamily,
      total: caseProofs.length,
      perTier: sortedPerTier,
      statuses: sortedStatuses,
    },
    totals: {
      readyCases: readyProofs.length,
      staleCases: staleProofs.length,
      readyDependentRewriteCases: readyProofs.filter((entry) =>
        entry.dependentRewrites.map((rewrite) => rewrite.rewrite.relationshipType).sort().join(',')
          === 'post-parent,postmeta-post').length,
      readyLiveRemotePreconditions: readyProofs.filter((entry) =>
        entry.dependentRewrites.every((rewrite) => rewrite.liveRemotePrecondition)).length,
      readyTargetPreserved: readyProofs.filter((entry) =>
        entry.appliedEvidence.targetRemotePreserved).length,
      staleApplyRefusedBeforeMutation: staleProofs.filter((entry) =>
        entry.refusal.refusedBeforeMutation).length,
      staleHashOnlyBlockers: staleProofs.filter((entry) =>
        entry.blockers.every((blocker) => blocker.class === 'stale-wordpress-graph-identity')).length,
    },
    invariants: {
      immutableBaseImporterProvenance: true,
      identityMapSource: mapSource,
      sourceIdentityNotMutated: true,
      importedTargetKeptRemote: true,
      childPostParentRewritten: true,
      sourcePostmetaRewrittenToImportedTarget: true,
      staleImportedTargetFailsClosed: true,
      evidenceHashOnly: true,
      releasePosture: 'NO-GO',
    },
    remainingUnmappedSurfaceProof: {
      mode: 'hash-only-surface-inventory',
      surfaceCount: remainingUnmappedSurfaces.length,
      surfaceHashes: remainingUnmappedSurfaces.map((surface) => `sha256:${digest(surface)}`),
      inventoryHash: `sha256:${digest(remainingUnmappedSurfaces)}`,
    },
    caseProofs,
  };
  aggregateEvidence.proofHash = `sha256:${digest(aggregateEvidence)}`;
  return { aggregateEvidence, cases };
}

function incrementCount(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function expectedPerTier(count) {
  return Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), count]));
}

test('RPP-0360 generated production importer/exporter identity-map coverage stays hash-only', () => {
  const { aggregateEvidence, cases } = buildAggregateEvidence();
  const replay = buildAggregateEvidence();
  const evidenceJson = JSON.stringify(aggregateEvidence);

  assert.deepEqual(aggregateEvidence, replay.aggregateEvidence);
  assert.equal(aggregateEvidence.rpp, 'RPP-0360');
  assert.equal(aggregateEvidence.evidenceSource, 'generated-production-importer-exporter-identity-map-v3');
  assert.equal(aggregateEvidence.status, 'support_only');
  assert.equal(aggregateEvidence.productionBacked, false);
  assert.equal(aggregateEvidence.releaseEligible, false);
  assert.equal(aggregateEvidence.releaseGate, 'NO-GO');
  assert.equal(aggregateEvidence.coverage.target, generatedTarget);
  assert.equal(aggregateEvidence.coverage.family, generatedFamily);
  assert.equal(aggregateEvidence.coverage.total, 20);
  assert.deepEqual(aggregateEvidence.coverage.perTier, expectedPerTier(2));
  assert.deepEqual(aggregateEvidence.coverage.statuses, { blocked: 10, ready: 10 });
  assert.equal(aggregateEvidence.totals.readyCases, 10);
  assert.equal(aggregateEvidence.totals.staleCases, 10);
  assert.equal(aggregateEvidence.totals.readyDependentRewriteCases, 10);
  assert.equal(aggregateEvidence.totals.readyLiveRemotePreconditions, 10);
  assert.equal(aggregateEvidence.totals.readyTargetPreserved, 10);
  assert.equal(aggregateEvidence.totals.staleApplyRefusedBeforeMutation, 10);
  assert.equal(aggregateEvidence.totals.staleHashOnlyBlockers, 10);
  assert.equal(aggregateEvidence.remainingUnmappedSurfaceProof.surfaceCount, remainingUnmappedSurfaces.length);
  assert.match(aggregateEvidence.remainingUnmappedSurfaceProof.inventoryHash, sha256EvidencePattern);
  for (const hash of aggregateEvidence.remainingUnmappedSurfaceProof.surfaceHashes) {
    assert.match(hash, sha256EvidencePattern);
  }
  assert.match(aggregateEvidence.proofHash, sha256EvidencePattern);
  assertNoRawValues(aggregateEvidence, cases.flatMap((testCase) => testCase.rawValues), 'RPP-0360 aggregate evidence');
  assert.equal(evidenceJson.includes('post_title'), false);
  assert.equal(evidenceJson.includes('post_content'), false);
  assert.equal(evidenceJson.includes('meta_value'), false);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregateEvidence, { label: 'RPP-0360 importer/exporter generated proof' }));
});

test('RPP-0360 evidence docs state remaining unmapped WordPress surfaces', () => {
  const evidenceText = fs.readFileSync(evidencePath, 'utf8');
  const normalizedEvidenceText = evidenceText.toLowerCase();

  assert.match(evidenceText, /Final release posture: `NO-GO`/);
  assert.match(evidenceText, /support-only local generated coverage/);
  assert.match(evidenceText, /Remaining unmapped WordPress surfaces/);
  for (const snippet of expectedDocSurfaceSnippets) {
    assert.ok(
      normalizedEvidenceText.includes(snippet.toLowerCase()),
      `missing unmapped surface doc snippet: ${snippet}`,
    );
  }
});
