# RPP-0395 nav menu item fail-closed reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0395 nav menu item fail-closed reference release-verifier carry-through, variant 5
Checklist item: RPP-0395 — Carry through the release verifier for nav menu item fail-closed reference, variant 5.

## Scope

This is a focused local release-verifier evidence slice for the WordPress
navigation menu item graph surface. It carries the existing nav menu item
fail-closed behavior into a release-verifier-shaped proof: a non-ready plan with
hash-only blockers, live-remote preconditions on unrelated safe mutations, and a
`PLAN_NOT_READY` apply refusal before any remote mutation.

This slice does not add nav menu support, broaden the WordPress graph identity
support matrix, update public progress surfaces, or touch release gate verdicts.

## Proof surface

`test/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.test.js`
builds a focused plan containing an otherwise safe file update, a standalone
`wp_terms` nav menu term create, and unsafe graph rows for:

- a `wp_posts.post_type = nav_menu_item` row;
- menu item metadata keys `_menu_item_object_id` and
  `_menu_item_menu_item_parent`;
- a `wp_term_taxonomy.taxonomy = nav_menu` row; and
- a dependent `wp_term_relationships` row that references both the unsupported
  menu item object and unsupported nav menu taxonomy target.

The proof verifies that the release-verifier evidence remains fail-closed:

- the plan stays `blocked` with five `stale-wordpress-graph-identity` blockers;
- no unsafe nav menu item, nav menu metadata, nav menu taxonomy, or dependent
  relationship mutation is planned;
- the relationship blocker carries target-support failures for both
  `wp_term_relationships.object_id` and
  `wp_term_relationships.term_taxonomy_id`;
- the independent file mutation and standalone term mutation retain live-remote
  preconditions for audit evidence; and
- `applyPlan()` rejects the non-ready plan with `PLAN_NOT_READY` before applying
  those safe mutations, preserving the remote snapshot hashes.

The emitted proof is hash-only: it records resource keys, relationship metadata,
blocker classes/reasons, state hashes, mutation hashes, precondition posture, and
release posture while omitting raw file contents, post titles/slugs/GUIDs, menu
term names/slugs/descriptions, and meta payloads.

## Observed fail-closed release-verifier shape

```json
{
  "status": "support_only",
  "verdict": "NAV_MENU_ITEM_GRAPH_FAIL_CLOSED_SUPPORT_ONLY",
  "plan": {
    "status": "blocked",
    "mutationCount": 2,
    "preconditionCount": 2,
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
  "applyRefusal": {
    "code": "PLAN_NOT_READY",
    "beforeMutation": true,
    "remoteSnapshotPreserved": true
  },
  "rawValuesIncluded": false
}
```

## Remaining unmapped WordPress surfaces

The nav menu item fail-closed release-verifier carry-through keeps the remaining
unmapped WordPress graph surfaces explicit. These surfaces remain intentionally
unsupported unless a future focused proof adds an owner/driver boundary,
parser-aware rewrite, or equivalent remote identity-map target:

- `wp_posts.post_type = nav_menu_item` rows and menu item graph metadata such as
  `_menu_item_object`, `_menu_item_object_id`,
  `_menu_item_menu_item_parent`, `_menu_item_type`, and `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent menu taxonomy
  relationships.
- Unsupported post graph rows such as `revision` and `wp_navigation`.
- Custom/plugin taxonomy rows such as `product_cat` without an explicit
  equivalent remote identity-map target.
- serialized block references that require parser-aware updates rather than
  scalar row-field rewrites.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only target/change evidence. This lane documents the remaining
unmapped WordPress surfaces and does not convert any of them into supported
release movement.

## Focused verification observed locally

```sh
node --check test/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.test.js
node --test test/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0315|RPP-0395|nav menu item' test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.test.js test/push-planner.test.js
node --test test/graph-mapping-inventory.test.js test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0317-serialized-block-reference-detection.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0395-nav-menu-item-fail-closed-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local result after focused validation: all commands above exited 0.
The focused RPP-0395 release-verifier test reported 2 subtests ok and 0 failed;
the adjacent nav menu item graph slice and documented-unmapped graph surfaces
also passed. Checklist completion lint returned `"ok": true`, the scoped
artifact redaction scan returned `"ok": true` for the touched docs, and both
diff whitespace checks returned exit code 0.

## Release posture

This is local support-only release-verifier carry-through evidence. It is not a
live production release run and is not accepted production-backed proof. Final
release remains **NO-GO** until separate live production evidence satisfies the
broader release boundary.
