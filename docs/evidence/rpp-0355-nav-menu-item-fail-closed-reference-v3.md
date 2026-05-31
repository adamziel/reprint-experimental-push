# RPP-0355 nav menu item fail-closed reference v3 evidence

Date: 2026-05-31
Lane: RPP-0355 nav menu item fail-closed reference, variant 3
Checklist item: RPP-0355 - Add generated coverage for nav menu item fail-closed reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is a focused local planner/apply proof for WordPress navigation menu item
graph references. It adds only the RPP-0355 variant-3 test and this evidence
note. It does not change planner behavior, generated harness fixtures, release
verifier code, progress pages, checklist state, or adjacent RPP-0335/RPP-0375
artifacts.

No production release was run. This evidence is support-only and does not claim
production release readiness.

## Proof surface

`test/rpp-0355-nav-menu-item-fail-closed-reference-v3.test.js` builds a
three-snapshot fixture where the local snapshot creates a `nav_menu_item` post,
its graph-bearing menu item metadata, a `nav_menu` taxonomy row, and a dependent
`wp_term_relationships` row that references both unsupported graph targets.

The generated proof requires:

- the plan to stay `blocked` with five `stale-wordpress-graph-identity`
  blockers;
- no unsafe mutation for the `nav_menu_item` post, menu item graph metadata,
  `nav_menu` taxonomy row, or dependent relationship row;
- the relationship blocker to carry hash-only target-support failures for
  `wp_term_relationships.object_id` and
  `wp_term_relationships.term_taxonomy_id`;
- an otherwise standalone `wp_terms` menu term mutation to remain insufficient
  to make the blocked plan applicable; and
- both the blocked plan and a forged-ready replay to reject before mutation
  while leaving the remote snapshot hash unchanged.

The summarized proof shape is:

```json
{
  "rpp": "RPP-0355",
  "evidenceSource": "nav-menu-item-fail-closed-reference-v3",
  "status": "support_only",
  "verdict": "NAV_MENU_ITEM_GRAPH_FAILS_CLOSED_HASH_ONLY",
  "plan": {
    "status": "blocked",
    "mutationCount": 1,
    "preconditionCount": 1,
    "blockerCount": 5
  },
  "failClosedSurfaces": {
    "navMenuItem": "stale-wordpress-graph-identity",
    "menuObjectMeta": "stale-wordpress-graph-identity",
    "menuParentMeta": "stale-wordpress-graph-identity",
    "navMenuTaxonomy": "stale-wordpress-graph-identity",
    "relationshipReferences": [
      "wp_term_relationships.object_id",
      "wp_term_relationships.term_taxonomy_id"
    ]
  },
  "failClosedApply": {
    "blockedPlan": "PLAN_NOT_READY",
    "forgedReadyPlan": "PLAN_INVARIANT_VIOLATION"
  },
  "rawValuesIncluded": false,
  "releaseGate": "NO-GO"
}
```

## Hash-only evidence

The proof records only resource keys, relationship metadata, support classes,
state labels, 64-character hashes, and proof hashes. It excludes raw file
contents, post titles, post slugs, GUIDs, menu term names, menu term slugs,
taxonomy descriptions, and metadata values.

The relationship reference evidence remains hash-only for both targets:

```json
{
  "relationshipKey": "wp_term_relationships.object_id",
  "relationshipType": "term-relationship-object",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:355\"]",
  "targetSupport": {
    "supported": false,
    "className": "stale-wordpress-graph-identity",
    "reason": "unsupported post graph surface nav_menu_item"
  },
  "hashes": {
    "targetBase": "<64 lowercase hex>",
    "targetLocal": "<64 lowercase hex>",
    "targetRemote": "<64 lowercase hex>"
  }
}
```

The deterministic subtest also checks that the serialized evidence envelope does
not include private fixture markers or raw row field names.

## Remaining unmapped WordPress surfaces

RPP-0355 proves nav menu item graph references fail closed and keeps the
remaining unmapped WordPress surfaces explicit. These surfaces remain
unsupported until a future proof adds an owner/driver boundary, parser-aware
rewrite, or equivalent remote identity-map target:

- `wp_posts.post_type = nav_menu_item` rows.
- Menu item `wp_postmeta` graph keys including `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent
  `wp_term_relationships` rows that reference nav menu items or nav menu
  taxonomy IDs.
- Unsupported post graph rows such as `revision` and `wp_navigation`.
- Custom/plugin taxonomy rows such as `product_cat` without an explicit
  equivalent remote identity-map target.
- serialized block references that require parser-aware updates instead of
  scalar row-field rewrites.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only target/change evidence. This variant documents the remaining
unmapped WordPress surfaces and does not convert any of them into supported
movement.

## Validation commands

```sh
node --check test/rpp-0355-nav-menu-item-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0355 test/rpp-0355-nav-menu-item-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0375 test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0355-nav-menu-item-fail-closed-reference-v3.md
git diff --check
git diff --cached --check
```

Observed local result: syntax check passed; the focused RPP-0355 run reported
2 subtests, 0 failures; adjacent RPP-0375 nav menu item fail-closed coverage
reported 1 subtest, 0 failures; artifact redaction scan returned `ok:true`;
and whitespace diff check passed.

## Release posture

This lane is local support-only evidence. It proves that unsupported nav menu
item graph references fail closed with hash-only evidence, but it is not live
production proof. Final release remains `NO-GO` until separate checked
production evidence satisfies the broader release gate set.
