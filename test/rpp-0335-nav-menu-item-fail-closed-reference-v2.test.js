import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0335-nav-menu-item-fail-closed-reference-v2.md',
);
const fixedNow = new Date('2026-05-30T03:35:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const menuItemId = 335;
const menuTermId = 9335;
const menuTermTaxonomyId = 9435;
const menuItemRowId = `ID:${menuItemId}`;
const menuObjectMetaRowId = `post_id:${menuItemId}:meta_key:_menu_item_object_id`;
const menuParentMetaRowId = `post_id:${menuItemId}:meta_key:_menu_item_menu_item_parent`;
const termRowId = `term_id:${menuTermId}`;
const taxonomyRowId = `term_taxonomy_id:${menuTermTaxonomyId}`;
const relationshipRowId = `object_id:${menuItemId}|term_taxonomy_id:${menuTermTaxonomyId}`;

const menuItemResourceKey = rowResourceKey('wp_posts', menuItemRowId);
const menuObjectMetaResourceKey = rowResourceKey('wp_postmeta', menuObjectMetaRowId);
const menuParentMetaResourceKey = rowResourceKey('wp_postmeta', menuParentMetaRowId);
const termResourceKey = rowResourceKey('wp_terms', termRowId);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', taxonomyRowId);
const relationshipResourceKey = rowResourceKey('wp_term_relationships', relationshipRowId);

const privateFixtures = Object.freeze([
  'Local Private RPP-0335 Menu Item',
  'local-private-rpp0335-menu-item',
  'local-private-rpp0335-menu-guid',
  'local-private-rpp0335-nav-menu-name',
  'local-private-rpp0335-nav-menu-slug',
  'local-private-rpp0335-nav-menu-description',
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
      'index.php': '<?php echo "base-private-rpp0335-index";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base target page',
          post_name: 'base-target-page',
          post_status: 'publish',
          post_type: 'page',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
    },
  };
}

function navMenuItemFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts[menuItemRowId] = {
    ID: menuItemId,
    post_title: 'Local Private RPP-0335 Menu Item',
    post_name: 'local-private-rpp0335-menu-item',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
    post_author: 0,
    guid: 'local-private-rpp0335-menu-guid',
  };
  local.db.wp_postmeta[menuObjectMetaRowId] = {
    post_id: menuItemId,
    meta_key: '_menu_item_object_id',
    meta_value: '1',
  };
  local.db.wp_postmeta[menuParentMetaRowId] = {
    post_id: menuItemId,
    meta_key: '_menu_item_menu_item_parent',
    meta_value: '777',
  };
  local.db.wp_terms[termRowId] = {
    term_id: menuTermId,
    name: 'local-private-rpp0335-nav-menu-name',
    slug: 'local-private-rpp0335-nav-menu-slug',
    term_group: 0,
  };
  local.db.wp_term_taxonomy[taxonomyRowId] = {
    term_taxonomy_id: menuTermTaxonomyId,
    term_id: menuTermId,
    taxonomy: 'nav_menu',
    description: 'local-private-rpp0335-nav-menu-description',
    parent: 0,
    count: 1,
  };
  local.db.wp_term_relationships[relationshipRowId] = {
    object_id: menuItemId,
    term_taxonomy_id: menuTermTaxonomyId,
    term_order: 0,
  };

  return { base, local, remote };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
}

function referenceFor(blocker, relationshipType) {
  return blocker?.references.find((reference) => reference.relationshipType === relationshipType) || null;
}

function captureFailedApply(remote, plan) {
  const candidateRemote = cloneJson(remote);
  const remoteHashBefore = sha256Evidence(candidateRemote);
  let beforeMutationCalls = 0;
  let caughtError = null;

  try {
    applyPlan(candidateRemote, plan, {
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  } catch (error) {
    caughtError = error;
  }

  assert.ok(caughtError instanceof PushPlanError, 'apply should fail with PushPlanError');
  const remoteHashAfter = sha256Evidence(candidateRemote);

  return {
    code: caughtError.code,
    status: caughtError.details?.status || null,
    issueCodes: Array.isArray(caughtError.details?.issues)
      ? caughtError.details.issues.map((issue) => issue.code).sort()
      : [],
    beforeMutationCalls,
    refusedBeforeMutation: beforeMutationCalls === 0,
    remoteUnchanged: remoteHashAfter === remoteHashBefore,
    remoteHashBefore,
    remoteHashAfter,
    detailsHash: sha256Evidence(caughtError.details || {}),
  };
}

function assertHashOnlyChange(change, label) {
  for (const state of ['base', 'local', 'remote']) {
    assert.match(change[state].hash, sha256Pattern, `${label}.${state}.hash`);
    assert.equal(Object.hasOwn(change[state], 'value'), false, `${label}.${state} must omit raw value`);
  }
}

function assertHashOnlyBlocker(blocker) {
  for (const hash of [blocker.baseHash, blocker.localHash, blocker.remoteHash]) {
    assert.match(hash, sha256Pattern);
  }
  assertHashOnlyChange(blocker.change, `${blocker.resourceKey}.change`);
}

function assertHashOnlyReference(reference) {
  for (const hash of [
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
  ]) {
    assert.match(hash, sha256Pattern);
  }
  assertHashOnlyChange(reference.targetChange, `${reference.relationshipKey}.targetChange`);
}

function summarizeBlocker(plan, resourceKey) {
  const blocker = blockerFor(plan, resourceKey);
  assert.ok(blocker, `missing blocker for ${resourceKey}`);

  return {
    resourceKey,
    class: blocker.class,
    reason: blocker.reason,
    resolutionPolicy: blocker.resolutionPolicy,
    plannedMutationPresent: Boolean(mutationFor(plan, resourceKey)),
    sourceState: {
      localChange: blocker.change.localChange,
      remoteChange: blocker.change.remoteChange,
      baseState: blocker.change.base.state,
      localState: blocker.change.local.state,
      remoteState: blocker.change.remote.state,
    },
    hashes: {
      base: blocker.baseHash,
      local: blocker.localHash,
      remote: blocker.remoteHash,
      changeBase: blocker.change.base.hash,
      changeLocal: blocker.change.local.hash,
      changeRemote: blocker.change.remote.hash,
    },
  };
}

function summarizeReference(reference) {
  return {
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    targetResourceKey: reference.targetResourceKey,
    targetTable: reference.targetTable,
    targetId: reference.targetId,
    targetSupport: {
      supported: reference.targetSupport.supported,
      className: reference.targetSupport.className,
      reason: reference.targetSupport.reason,
    },
    targetState: {
      localChange: reference.targetChange.localChange,
      remoteChange: reference.targetChange.remoteChange,
      baseState: reference.targetChange.base.state,
      localState: reference.targetChange.local.state,
      remoteState: reference.targetChange.remote.state,
    },
    hashes: {
      targetBase: reference.targetBaseHash,
      targetLocal: reference.targetLocalHash,
      targetRemote: reference.targetRemoteHash,
      targetChangeBase: reference.targetChange.base.hash,
      targetChangeLocal: reference.targetChange.local.hash,
      targetChangeRemote: reference.targetChange.remote.hash,
    },
  };
}

function buildRpp0335Evidence() {
  const fixture = navMenuItemFixture();
  const plan = planFor(fixture);
  const relationshipBlocker = blockerFor(plan, relationshipResourceKey);
  const objectReference = referenceFor(relationshipBlocker, 'term-relationship-object');
  const taxonomyReference = referenceFor(relationshipBlocker, 'term-relationship-taxonomy');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.mutations.length, 1);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(plan.blockers.length, 5);
  assert.equal(mutationFor(plan, menuItemResourceKey), null);
  assert.equal(mutationFor(plan, menuObjectMetaResourceKey), null);
  assert.equal(mutationFor(plan, menuParentMetaResourceKey), null);
  assert.equal(mutationFor(plan, taxonomyResourceKey), null);
  assert.equal(mutationFor(plan, relationshipResourceKey), null);
  assert.ok(mutationFor(plan, termResourceKey), 'standalone nav menu term is safe but blocked plan cannot apply');

  for (const resourceKey of [
    menuItemResourceKey,
    menuObjectMetaResourceKey,
    menuParentMetaResourceKey,
    taxonomyResourceKey,
    relationshipResourceKey,
  ]) {
    assertHashOnlyBlocker(blockerFor(plan, resourceKey));
  }
  assert.ok(objectReference, 'missing nav menu item object reference evidence');
  assert.ok(taxonomyReference, 'missing nav_menu taxonomy reference evidence');
  assertHashOnlyReference(objectReference);
  assertHashOnlyReference(taxonomyReference);

  const evidence = {
    rpp: 'RPP-0335',
    evidenceSource: 'nav-menu-item-fail-closed-reference-v2',
    status: 'support_only',
    verdict: 'NAV_MENU_ITEM_GRAPH_FAILS_CLOSED_HASH_ONLY',
    evidenceScope: 'local-planner-and-apply-model',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    plan: {
      status: plan.status,
      summary: { ...plan.summary },
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      hash: sha256Evidence(plan),
    },
    standaloneMenuTerm: {
      resourceKey: termResourceKey,
      plannedMutationPresent: Boolean(mutationFor(plan, termResourceKey)),
      planStillBlocked: plan.status === 'blocked',
    },
    failClosedSurfaces: {
      navMenuItem: summarizeBlocker(plan, menuItemResourceKey),
      menuObjectMeta: summarizeBlocker(plan, menuObjectMetaResourceKey),
      menuParentMeta: summarizeBlocker(plan, menuParentMetaResourceKey),
      navMenuTaxonomy: summarizeBlocker(plan, taxonomyResourceKey),
      relationship: {
        ...summarizeBlocker(plan, relationshipResourceKey),
        references: [
          summarizeReference(objectReference),
          summarizeReference(taxonomyReference),
        ],
      },
    },
    invariants: {
      noUnsafeNavMenuMutations: ![
        menuItemResourceKey,
        menuObjectMetaResourceKey,
        menuParentMetaResourceKey,
        taxonomyResourceKey,
        relationshipResourceKey,
      ].some((resourceKey) => mutationFor(plan, resourceKey)),
      relationshipCarriesTargetSupportFailures:
        objectReference.targetSupport.className === 'stale-wordpress-graph-identity'
        && taxonomyReference.targetSupport.className === 'stale-wordpress-graph-identity',
      blockersAreHashOnly: true,
    },
    failClosedApply: {
      blockedPlan: captureFailedApply(fixture.remote, plan),
      forgedReadyPlan: captureFailedApply(fixture.remote, {
        ...plan,
        status: 'ready',
      }),
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
    },
  };

  return {
    plan,
    evidence: {
      ...evidence,
      proofHash: sha256Evidence(evidence),
    },
  };
}

function assertHashOnlyEvidence(evidence) {
  const serialized = JSON.stringify(evidence);

  for (const privateFixture of privateFixtures) {
    assert.equal(serialized.includes(privateFixture), false, `RPP-0335 evidence leaked ${privateFixture}`);
  }
  for (const rawField of ['post_title', 'post_name', 'guid', 'meta_value', 'name', 'slug', 'description']) {
    assert.equal(serialized.includes(rawField), false, `RPP-0335 evidence exposed raw field ${rawField}`);
  }

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0335 nav menu item v2 evidence' }));
}

test('RPP-0335 proves nav menu item graph references fail closed with hash-only evidence', () => {
  const { plan, evidence } = buildRpp0335Evidence();

  assert.equal(evidence.rpp, 'RPP-0335');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'NAV_MENU_ITEM_GRAPH_FAILS_CLOSED_HASH_ONLY');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.plan.status, 'blocked');
  assert.equal(evidence.plan.mutationCount, 1);
  assert.equal(evidence.plan.preconditionCount, 1);
  assert.equal(evidence.plan.blockerCount, 5);
  assert.match(evidence.plan.hash, sha256EvidencePattern);
  assert.match(evidence.proofHash, sha256EvidencePattern);
  assert.equal(plan.blockers.length, 5);

  assert.equal(evidence.standaloneMenuTerm.resourceKey, termResourceKey);
  assert.equal(evidence.standaloneMenuTerm.plannedMutationPresent, true);
  assert.equal(evidence.standaloneMenuTerm.planStillBlocked, true);

  assert.equal(evidence.failClosedSurfaces.navMenuItem.class, 'stale-wordpress-graph-identity');
  assert.match(evidence.failClosedSurfaces.navMenuItem.reason, /unsupported post graph surface nav_menu_item/);
  assert.equal(evidence.failClosedSurfaces.menuObjectMeta.class, 'stale-wordpress-graph-identity');
  assert.match(evidence.failClosedSurfaces.menuObjectMeta.reason, /_menu_item_object_id/);
  assert.equal(evidence.failClosedSurfaces.menuParentMeta.class, 'stale-wordpress-graph-identity');
  assert.match(evidence.failClosedSurfaces.menuParentMeta.reason, /_menu_item_menu_item_parent/);
  assert.equal(evidence.failClosedSurfaces.navMenuTaxonomy.class, 'stale-wordpress-graph-identity');
  assert.match(evidence.failClosedSurfaces.navMenuTaxonomy.reason, /unsupported taxonomy graph surface nav_menu/);
  assert.equal(evidence.failClosedSurfaces.relationship.class, 'stale-wordpress-graph-identity');
  assert.match(evidence.failClosedSurfaces.relationship.reason, /without proven identity mapping or reference rewriting/);
  assert.equal(evidence.failClosedSurfaces.relationship.references.length, 2);

  assert.deepEqual(
    evidence.failClosedSurfaces.relationship.references.map((reference) => reference.relationshipKey).sort(),
    ['wp_term_relationships.object_id', 'wp_term_relationships.term_taxonomy_id'],
  );
  for (const reference of evidence.failClosedSurfaces.relationship.references) {
    assert.equal(reference.targetSupport.supported, false);
    assert.equal(reference.targetSupport.className, 'stale-wordpress-graph-identity');
    assert.equal(reference.targetState.localChange, 'create');
    assert.equal(reference.targetState.remoteChange, 'unchanged');
  }

  assert.deepEqual(evidence.invariants, {
    noUnsafeNavMenuMutations: true,
    relationshipCarriesTargetSupportFailures: true,
    blockersAreHashOnly: true,
  });
  assert.equal(evidence.failClosedApply.blockedPlan.code, 'PLAN_NOT_READY');
  assert.equal(evidence.failClosedApply.blockedPlan.status, 'blocked');
  assert.equal(evidence.failClosedApply.blockedPlan.refusedBeforeMutation, true);
  assert.equal(evidence.failClosedApply.blockedPlan.remoteUnchanged, true);
  assert.equal(
    evidence.failClosedApply.blockedPlan.remoteHashAfter,
    evidence.failClosedApply.blockedPlan.remoteHashBefore,
  );
  assert.equal(evidence.failClosedApply.forgedReadyPlan.code, 'PLAN_INVARIANT_VIOLATION');
  assert.deepEqual(evidence.failClosedApply.forgedReadyPlan.issueCodes, ['READY_PLAN_HAS_BLOCKERS']);
  assert.equal(evidence.failClosedApply.forgedReadyPlan.refusedBeforeMutation, true);
  assert.equal(evidence.failClosedApply.forgedReadyPlan.remoteUnchanged, true);

  assertHashOnlyEvidence(evidence);
});

test('RPP-0335 evidence docs state remaining unmapped WordPress surfaces', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0335 nav menu item fail-closed reference v2 evidence$/m);
  assert.match(evidenceDoc, /## Remaining unmapped WordPress surfaces/);
  assert.match(evidenceDoc, /nav menu item graph references fail closed/);
  for (const documentedSurface of [
    '`wp_posts.post_type = nav_menu_item`',
    '`wp_term_taxonomy.taxonomy = nav_menu`',
    '`wp_navigation`',
    '`revision`',
    '`product_cat`',
    'serialized block references',
    'stale-wordpress-graph-identity',
    'hash-only',
  ]) {
    assert.ok(
      evidenceDoc.includes(documentedSurface),
      `missing documented surface: ${documentedSurface}`,
    );
  }
});
