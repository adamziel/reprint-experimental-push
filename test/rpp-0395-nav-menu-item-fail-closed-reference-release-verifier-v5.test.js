import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.md',
);
const checklistPath = path.join(repoRoot, 'docs/reprint-push-completion-checklist.md');
const fixedNow = new Date('2026-05-30T12:39:50.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const menuItemId = 395;
const menuTermId = 9395;
const menuTermTaxonomyId = 9495;
const menuItemRowId = `ID:${menuItemId}`;
const menuObjectMetaRowId = `post_id:${menuItemId}:meta_key:_menu_item_object_id`;
const menuParentMetaRowId = `post_id:${menuItemId}:meta_key:_menu_item_menu_item_parent`;
const termRowId = `term_id:${menuTermId}`;
const taxonomyRowId = `term_taxonomy_id:${menuTermTaxonomyId}`;
const relationshipRowId = `object_id:${menuItemId}|term_taxonomy_id:${menuTermTaxonomyId}`;
const fileResource = Object.freeze({ type: 'file', path: 'index.php', key: 'file:index.php' });

const menuItemResourceKey = rowResourceKey('wp_posts', menuItemRowId);
const menuObjectMetaResourceKey = rowResourceKey('wp_postmeta', menuObjectMetaRowId);
const menuParentMetaResourceKey = rowResourceKey('wp_postmeta', menuParentMetaRowId);
const termResourceKey = rowResourceKey('wp_terms', termRowId);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', taxonomyRowId);
const relationshipResourceKey = rowResourceKey('wp_term_relationships', relationshipRowId);

const rawFixtures = Object.freeze([
  '<?php echo "base-private-rpp0395-index";',
  '<?php echo "local-private-rpp0395-independent-file";',
  'Local Private RPP-0395 Menu Item',
  'local-private-rpp0395-menu-item',
  'local-private-rpp0395-menu-guid',
  'local-private-rpp0395-nav-menu-name',
  'local-private-rpp0395-nav-menu-slug',
  'local-private-rpp0395-nav-menu-description',
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
      'index.php': '<?php echo "base-private-rpp0395-index";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base target post',
          post_name: 'base-target-post',
          post_status: 'publish',
          post_type: 'post',
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

function navMenuItemReleaseVerifierFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['index.php'] = '<?php echo "local-private-rpp0395-independent-file";';
  local.db.wp_posts[menuItemRowId] = {
    ID: menuItemId,
    post_title: 'Local Private RPP-0395 Menu Item',
    post_name: 'local-private-rpp0395-menu-item',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
    post_author: 0,
    guid: 'local-private-rpp0395-menu-guid',
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
    name: 'local-private-rpp0395-nav-menu-name',
    slug: 'local-private-rpp0395-nav-menu-slug',
    term_group: 0,
  };
  local.db.wp_term_taxonomy[taxonomyRowId] = {
    term_taxonomy_id: menuTermTaxonomyId,
    term_id: menuTermId,
    taxonomy: 'nav_menu',
    description: 'local-private-rpp0395-nav-menu-description',
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

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function summarizeHashOnlyBlocker(plan, resourceKey) {
  const blocker = blockerFor(plan, resourceKey);
  assert.ok(blocker, `missing blocker for ${resourceKey}`);
  return {
    resourceKey,
    class: blocker.class,
    reason: blocker.reason,
    resolutionPolicy: blocker.resolutionPolicy,
    plannedMutationPresent: Boolean(mutationFor(plan, resourceKey)),
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

function summarizeHashOnlyReference(reference) {
  return {
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    targetResourceKey: reference.targetResourceKey,
    targetSupport: {
      supported: reference.targetSupport.supported,
      className: reference.targetSupport.className,
      reason: reference.targetSupport.reason,
    },
    targetHashes: {
      base: reference.targetBaseHash,
      local: reference.targetLocalHash,
      remote: reference.targetRemoteHash,
      changeBase: reference.targetChange.base.hash,
      changeLocal: reference.targetChange.local.hash,
      changeRemote: reference.targetChange.remote.hash,
    },
  };
}

function assertHashFields(value, label) {
  for (const [key, hash] of Object.entries(value)) {
    assert.match(hash, sha256Pattern, `${label}.${key} is not a sha256 hash`);
  }
}

function summarizeRpp0395NavMenuItemReleaseVerifierProof({ plan, applyError, remoteBefore, remoteAfter }) {
  const independentMutation = mutationFor(plan, fileResource.key);
  const independentPrecondition = preconditionFor(plan, fileResource.key);
  const termMutation = mutationFor(plan, termResourceKey);
  const termPrecondition = preconditionFor(plan, termResourceKey);
  const relationshipBlocker = blockerFor(plan, relationshipResourceKey);
  assert.ok(relationshipBlocker, 'missing relationship blocker');
  const objectReference = relationshipBlocker.references.find((reference) =>
    reference.relationshipType === 'term-relationship-object');
  const taxonomyReference = relationshipBlocker.references.find((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy');
  assert.ok(objectReference, 'missing nav menu item object reference');
  assert.ok(taxonomyReference, 'missing nav_menu taxonomy reference');

  return {
    rpp: 'RPP-0395',
    evidenceSource: 'release-verifier-nav-menu-item-fail-closed-reference-v5',
    status: 'support_only',
    verdict: 'NAV_MENU_ITEM_GRAPH_FAIL_CLOSED_SUPPORT_ONLY',
    evidenceScope: 'local-release-verifier',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      acceptedForReleaseGate: false,
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      note: 'nav menu item fail-closed release-verifier carry-through is local support evidence only',
    },
    releaseVerifier: {
      checkedBy: 'node --test test/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.test.js',
      check: 'nav-menu-item-fail-closed-reference',
      variant: 'v5',
      serializedPlanEvidence: 'hash-only',
      refusalBeforeMutation: true,
    },
    plan: {
      status: plan.status,
      summary: { ...plan.summary },
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      hash: sha256Evidence(plan),
    },
    independentMutation: independentMutation ? {
      resourceKey: independentMutation.resourceKey,
      action: independentMutation.action,
      changeKind: independentMutation.changeKind,
      preconditionCheckedAgainst: independentPrecondition?.checkedAgainst || null,
      preconditionExpectedHashMatchesMutation: independentPrecondition?.expectedHash === independentMutation.remoteBeforeHash,
      baseHash: independentMutation.baseHash,
      localHash: independentMutation.localHash,
      remoteBeforeHash: independentMutation.remoteBeforeHash,
      mutationHash: sha256Evidence(independentMutation),
    } : null,
    standaloneMenuTermMutation: termMutation ? {
      resourceKey: termMutation.resourceKey,
      action: termMutation.action,
      changeKind: termMutation.changeKind,
      preconditionCheckedAgainst: termPrecondition?.checkedAgainst || null,
      preconditionExpectedHashMatchesMutation: termPrecondition?.expectedHash === termMutation.remoteBeforeHash,
      baseHash: termMutation.baseHash,
      localHash: termMutation.localHash,
      remoteBeforeHash: termMutation.remoteBeforeHash,
      mutationHash: sha256Evidence(termMutation),
    } : null,
    failClosedSurfaces: {
      navMenuItem: summarizeHashOnlyBlocker(plan, menuItemResourceKey),
      menuObjectMeta: summarizeHashOnlyBlocker(plan, menuObjectMetaResourceKey),
      menuParentMeta: summarizeHashOnlyBlocker(plan, menuParentMetaResourceKey),
      navMenuTaxonomy: summarizeHashOnlyBlocker(plan, taxonomyResourceKey),
      relationship: {
        ...summarizeHashOnlyBlocker(plan, relationshipResourceKey),
        references: [
          summarizeHashOnlyReference(objectReference),
          summarizeHashOnlyReference(taxonomyReference),
        ],
      },
    },
    invariantChecks: {
      navMenuItemBlocked: blockerFor(plan, menuItemResourceKey)?.class === 'stale-wordpress-graph-identity',
      menuItemMetaBlocked: blockerFor(plan, menuObjectMetaResourceKey)?.class === 'stale-wordpress-graph-identity'
        && blockerFor(plan, menuParentMetaResourceKey)?.class === 'stale-wordpress-graph-identity',
      navMenuTaxonomyBlocked: blockerFor(plan, taxonomyResourceKey)?.class === 'stale-wordpress-graph-identity',
      relationshipCarriesTargetSupportFailures: objectReference.targetSupport.className === 'stale-wordpress-graph-identity'
        && taxonomyReference.targetSupport.className === 'stale-wordpress-graph-identity',
      noUnsafeNavMenuMutations: ![
        menuItemResourceKey,
        menuObjectMetaResourceKey,
        menuParentMetaResourceKey,
        taxonomyResourceKey,
        relationshipResourceKey,
      ].some((resourceKey) => mutationFor(plan, resourceKey)),
    },
    applyRefusal: {
      code: applyError.code,
      status: applyError.details.status,
      beforeMutation: true,
      detailsHash: sha256Evidence(applyError.details),
      remoteSnapshotPreserved: digest(remoteAfter) === digest(remoteBefore),
      remoteHashBefore: sha256Evidence(remoteBefore),
      remoteHashAfter: sha256Evidence(remoteAfter),
      independentFileHashBefore: sha256Evidence(resourceHash(remoteBefore, fileResource)),
      independentFileHashAfter: sha256Evidence(resourceHash(remoteAfter, fileResource)),
      menuItemHashBefore: sha256Evidence(resourceHash(remoteBefore, { type: 'row', table: 'wp_posts', id: menuItemRowId })),
      menuItemHashAfter: sha256Evidence(resourceHash(remoteAfter, { type: 'row', table: 'wp_posts', id: menuItemRowId })),
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: rawFixtures.length,
    },
    rawValuesIncluded: false,
    proofHash: sha256Evidence({
      planHash: digest(plan),
      relationshipResourceKey,
      menuItemResourceKey,
      taxonomyResourceKey,
      applyRefusal: applyError.code,
      remotePreserved: digest(remoteAfter) === digest(remoteBefore),
    }),
  };
}

function assertNoRawFixtures(value, label = 'RPP-0395 release verifier evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  for (const rawField of ['post_title', 'post_content', 'post_name', 'guid', 'meta_value', 'name', 'slug', 'description', 'content']) {
    assert.equal(serialized.includes(rawField), false, `${label} exposed raw field ${rawField}`);
  }
}

test('RPP-0395 release verifier carries nav menu item fail-closed evidence before mutation', () => {
  const { base, local, remote } = navMenuItemReleaseVerifierFixture();
  const plan = planFor(base, local, remote);
  const remoteAfter = cloneJson(remote);
  const remoteBefore = cloneJson(remoteAfter);
  const applyError = captureError(() => applyPlan(remoteAfter, plan));
  const summary = summarizeRpp0395NavMenuItemReleaseVerifierProof({
    plan,
    applyError,
    remoteBefore,
    remoteAfter,
  });

  assert.ok(applyError instanceof PushPlanError);
  assert.equal(summary.rpp, 'RPP-0395');
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'NAV_MENU_ITEM_GRAPH_FAIL_CLOSED_SUPPORT_ONLY');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.equal(summary.releaseVerifier.check, 'nav-menu-item-fail-closed-reference');
  assert.equal(summary.releaseVerifier.variant, 'v5');

  assert.equal(summary.plan.status, 'blocked');
  assert.equal(summary.plan.mutationCount, 2);
  assert.equal(summary.plan.preconditionCount, 2);
  assert.equal(summary.plan.blockerCount, 5);
  assert.equal(summary.plan.summary.mutations, 2);
  assert.equal(summary.plan.summary.blockers, 5);
  assert.match(summary.plan.hash, sha256EvidencePattern);

  assert.equal(summary.independentMutation.resourceKey, 'file:index.php');
  assert.equal(summary.independentMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(summary.independentMutation.preconditionExpectedHashMatchesMutation, true);
  assert.match(summary.independentMutation.mutationHash, sha256EvidencePattern);
  assert.equal(summary.standaloneMenuTermMutation.resourceKey, termResourceKey);
  assert.equal(summary.standaloneMenuTermMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(summary.standaloneMenuTermMutation.preconditionExpectedHashMatchesMutation, true);

  assert.equal(summary.failClosedSurfaces.navMenuItem.class, 'stale-wordpress-graph-identity');
  assert.match(summary.failClosedSurfaces.navMenuItem.reason, /unsupported post graph surface nav_menu_item/);
  assert.equal(summary.failClosedSurfaces.navMenuItem.plannedMutationPresent, false);
  assert.equal(summary.failClosedSurfaces.menuObjectMeta.class, 'stale-wordpress-graph-identity');
  assert.match(summary.failClosedSurfaces.menuObjectMeta.reason, /_menu_item_object_id/);
  assert.equal(summary.failClosedSurfaces.menuParentMeta.class, 'stale-wordpress-graph-identity');
  assert.match(summary.failClosedSurfaces.menuParentMeta.reason, /_menu_item_menu_item_parent/);
  assert.equal(summary.failClosedSurfaces.navMenuTaxonomy.class, 'stale-wordpress-graph-identity');
  assert.match(summary.failClosedSurfaces.navMenuTaxonomy.reason, /unsupported taxonomy graph surface nav_menu/);
  assert.equal(summary.failClosedSurfaces.relationship.class, 'stale-wordpress-graph-identity');
  assert.equal(summary.failClosedSurfaces.relationship.plannedMutationPresent, false);
  assert.equal(summary.failClosedSurfaces.relationship.references.length, 2);
  assert.deepEqual(
    summary.failClosedSurfaces.relationship.references.map((reference) => reference.relationshipKey).sort(),
    ['wp_term_relationships.object_id', 'wp_term_relationships.term_taxonomy_id'],
  );
  for (const reference of summary.failClosedSurfaces.relationship.references) {
    assert.equal(reference.targetSupport.supported, false);
    assert.equal(reference.targetSupport.className, 'stale-wordpress-graph-identity');
    assertHashFields(reference.targetHashes, `${reference.relationshipKey}.targetHashes`);
  }
  for (const blocker of [
    summary.failClosedSurfaces.navMenuItem,
    summary.failClosedSurfaces.menuObjectMeta,
    summary.failClosedSurfaces.menuParentMeta,
    summary.failClosedSurfaces.navMenuTaxonomy,
    summary.failClosedSurfaces.relationship,
  ]) {
    assertHashFields(blocker.hashes, `${blocker.resourceKey}.hashes`);
  }

  assert.deepEqual(summary.invariantChecks, {
    navMenuItemBlocked: true,
    menuItemMetaBlocked: true,
    navMenuTaxonomyBlocked: true,
    relationshipCarriesTargetSupportFailures: true,
    noUnsafeNavMenuMutations: true,
  });
  assert.equal(summary.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(summary.applyRefusal.status, 'blocked');
  assert.equal(summary.applyRefusal.beforeMutation, true);
  assert.equal(summary.applyRefusal.remoteSnapshotPreserved, true);
  assert.equal(summary.applyRefusal.remoteHashAfter, summary.applyRefusal.remoteHashBefore);
  assert.equal(summary.applyRefusal.independentFileHashAfter, summary.applyRefusal.independentFileHashBefore);
  assert.equal(summary.applyRefusal.menuItemHashAfter, summary.applyRefusal.menuItemHashBefore);
  assert.match(summary.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(summary.proofHash, sha256EvidencePattern);
  assert.equal(summary.rawValuesIncluded, false);
  assertNoRawFixtures(summary);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(summary, { label: 'RPP-0395 nav menu item release verifier proof' }));
});

test('RPP-0395 evidence docs state remaining unmapped WordPress surfaces', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');
  const checklist = fs.readFileSync(checklistPath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0395 nav menu item fail-closed reference release verifier v5 evidence$/m);
  assert.match(evidenceDoc, /## Remaining unmapped WordPress surfaces/);
  assert.match(evidenceDoc, /nav menu item fail-closed release-verifier carry-through/);
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
  assert.match(
    checklist,
    /^- \[x\] RPP-0395 \(Mid \/ graph-identity\) Carry through the release verifier for nav menu item fail-closed reference, variant 5\. Success: docs state remaining unmapped WordPress surfaces\.$/m,
  );
});
