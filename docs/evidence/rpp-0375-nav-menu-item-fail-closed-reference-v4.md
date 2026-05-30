# RPP-0375 nav menu item fail-closed reference v4 evidence

Date: 2026-05-30
Lane: RPP-0375 nav menu item fail-closed reference, variant 4
Checklist item: RPP-0375 — Add focused regression coverage for nav menu item fail-closed reference, variant 4.

## Scope

This focused regression slice stays local to WordPress graph identity planning for
navigation menu item references. It does not change production planner behavior,
generated harness files, release verifier surfaces, progress pages, or adjacent
RPP-0374/RPP-0376 artifacts.

## Evidence added

- `test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js` adds a
  minimal three-snapshot case where base/remote already contain a
  `wp_posts.post_type = "nav_menu_item"` row and its `nav_menu` taxonomy row.
- The local snapshot creates only a new `wp_term_relationships` row pointing at
  those unchanged targets. The planner must still fail closed because reference
  validation evaluates unsupported graph target support, not only directly
  mutated target rows.
- The relationship row is not emitted as a mutation. Its blocker is
  `stale-wordpress-graph-identity` with
  `preserve-remote-wordpress-graph-and-stop` and two hash-only references:
  `wp_term_relationships.object_id` to the unsupported `nav_menu_item` post and
  `wp_term_relationships.term_taxonomy_id` to the unsupported `nav_menu`
  taxonomy.
- The unchanged target rows do not receive direct blockers in this scenario;
  they appear only as reference evidence on the blocked relationship mutation.
- `applyPlan()` refuses with `PLAN_NOT_READY` before mutating the remote
  snapshot, and the blocker/reference evidence omits private post, guid, term,
  slug, and taxonomy description values.

## Observed target shapes

Unsupported existing nav menu item target referenced by a new relationship:

```json
{
  "relationshipKey": "wp_term_relationships.object_id",
  "relationshipType": "term-relationship-object",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:375\"]",
  "targetSupport": {
    "className": "stale-wordpress-graph-identity",
    "reason": "unsupported post graph surface nav_menu_item"
  },
  "targetEvidence": "hash-only"
}
```

Unsupported existing nav menu taxonomy target referenced by the same new
relationship:

```json
{
  "relationshipKey": "wp_term_relationships.term_taxonomy_id",
  "relationshipType": "term-relationship-taxonomy",
  "targetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:9475\"]",
  "targetSupport": {
    "className": "stale-wordpress-graph-identity",
    "reason": "unsupported taxonomy graph surface nav_menu"
  },
  "targetEvidence": "hash-only"
}
```

## Current unmapped WordPress surfaces

RPP-0375 keeps the navigation menu graph intentionally fail-closed until a
future owner/driver or parser-aware identity proof exists. Remaining unmapped or
fail-closed WordPress surfaces are:

- `wp_posts.post_type = nav_menu_item` rows.
- Menu item `wp_postmeta` graph keys including `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent
  `wp_term_relationships` rows that reference nav menu items or nav menu
  taxonomy IDs.
- Other unsupported post graph rows such as `revision` and `wp_navigation`.
- Serialized block references in post content or excerpts that need
  parser-aware graph identity mapping.
- Custom/plugin taxonomy rows without an explicit equivalent remote identity map
  target.

## Validation commands

```sh
node --check test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js
node --test test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js
node --test test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js
node --test --test-name-pattern='RPP-0315|RPP-0375|graph mapping inventory' test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/rpp-0375-nav-menu-item-fail-closed-reference-v4.test.js test/graph-mapping-inventory.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0375-nav-menu-item-fail-closed-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result: all commands above returned exit code 0; the focused
RPP-0375 command reported 1 subtest and 0 failures.
