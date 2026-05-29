# RPP-0315 nav menu item fail-closed reference evidence

Date: 2026-05-29
Lane: RPP-0315 nav menu item fail-closed reference, variant 1
Checklist item: RPP-0315 — Implement nav menu item fail-closed reference, variant 1.

## Scope

This slice stays inside focused graph-identity proof for WordPress navigation
menu item surfaces. It does not touch public progress surfaces, generated-harness
targets, merge-invariant logic, plugin-driver behavior, executor-auth routes,
recovery/storage, topology, or release-ops code.

## Evidence added

- `test/rpp-0315-nav-menu-item-fail-closed-reference.test.js` proves that a
  local `wp_posts` row with `post_type: "nav_menu_item"` fails closed as
  `stale-wordpress-graph-identity` when there is no proven identity map for the
  menu item graph.
- The same focused proof covers menu item metadata rows using unsupported
  graph-bearing keys such as `_menu_item_object_id` and
  `_menu_item_menu_item_parent`. Those rows are not planned as mutations; they
  stop with `preserve-remote-wordpress-graph-and-stop` hash-only blockers.
- The proof also covers a dependent `wp_term_relationships` row that would
  attach the local menu item to a `nav_menu` taxonomy row. Its
  `object_id` reference points at the unsupported `nav_menu_item` post target,
  and its `term_taxonomy_id` reference points at the unsupported `nav_menu`
  taxonomy target. Both references carry target support failures and hash-only
  target change evidence.
- `applyPlan()` refuses the blocked plan with `PLAN_NOT_READY` before mutating
  the remote snapshot, while an unrelated standalone `wp_terms` row may still be
  present in the blocked plan's mutation list because the unsafe graph rows keep
  the overall plan non-ready.

## Observed target shapes

Unsupported nav menu item post surface:

```json
{
  "resourceKey": "row:[\"wp_posts\",\"ID:315\"]",
  "class": "stale-wordpress-graph-identity",
  "reason": "unsupported post graph surface nav_menu_item",
  "resolutionPolicy": "preserve-remote-wordpress-graph-and-stop",
  "plannedMutation": false
}
```

Unsupported menu item metadata surface:

```json
{
  "resourceKey": "row:[\"wp_postmeta\",\"post_id:315:meta_key:_menu_item_object_id\"]",
  "class": "stale-wordpress-graph-identity",
  "reason": "unsupported menu item metadata graph surface _menu_item_object_id",
  "plannedMutation": false
}
```

Dependent menu relationship reference surface:

```json
{
  "resourceKey": "row:[\"wp_term_relationships\",\"object_id:315|term_taxonomy_id:9415\"]",
  "objectReference": {
    "relationshipKey": "wp_term_relationships.object_id",
    "relationshipType": "term-relationship-object",
    "targetResourceKey": "row:[\"wp_posts\",\"ID:315\"]",
    "targetSupport": "stale-wordpress-graph-identity"
  },
  "taxonomyReference": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "targetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:9415\"]",
    "targetSupport": "stale-wordpress-graph-identity"
  },
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false
}
```

## Current unmapped WordPress surfaces

RPP-0315 documents the nav menu item class as intentionally fail-closed until a
future owner/driver or parser-aware identity proof exists. Current unmapped or
fail-closed surfaces are:

- `wp_posts.post_type = nav_menu_item` rows.
- Menu item `wp_postmeta` graph keys: `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent
  `wp_term_relationships` rows that reference nav menu items or nav menu
  taxonomy IDs.
- Other unsupported post graph rows such as `revision` and `wp_navigation`.
- Serialized block references in post content or excerpts that require
  parser-aware graph identity mapping.
- Custom/plugin taxonomy rows without an explicit, equivalent remote identity
  map target.

The focused proof therefore keeps navigation menu movement fail-closed by
default and records only resource keys, states, and hashes for the unsupported
targets.

## Validation commands

```sh
node --test test/rpp-0315-nav-menu-item-fail-closed-reference.test.js
umask 077 && node --test --test-name-pattern='RPP-0315|graph mapping inventory' test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/graph-mapping-inventory.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0315-nav-menu-item-fail-closed-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0315 command: 1 subtest, 0 failures.
The broader focused graph-identity command was rerun with `umask 077` after
the default session umask produced a non-executable temporary benchmark
directory; the rerun, checklist completion lint, touched document artifact
redaction scan, and whitespace diff check all returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused nav menu item fail-closed reference slice.
