# RPP-0390 post_tag taxonomy reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0390 post_tag taxonomy reference release verifier, variant 5
Checklist item: RPP-0390 — Carry through the release verifier for post_tag taxonomy reference, variant 5.

## Scope

This slice stays inside local release-verifier evidence for the core WordPress
`post_tag` taxonomy surface. It adds the focused RPP-0390 regression, this
evidence note, and the single RPP-0390 checklist line. It does not touch
generated harness targets, public progress surfaces, release docs, RPP-0389,
RPP-0391, or unrelated graph-identity tests.

## Evidence added

- `test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js`
  feeds a synthetic live release-verifier summary into
  `buildComplexSiteReleaseEvidence()` with `postTagTaxonomyGraph` required.
- The focused proof requires the release plan to carry
  `row:["wp_term_taxonomy","term_taxonomy_id:72941"]` as a
  `wp_term_taxonomy` mutation with `term_taxonomy_id:72941`, `term_id:72931`,
  and `taxonomy:"post_tag"`.
- The proof also requires the same mutation to have a live-remote precondition
  whose hash matches the mutation base and remote-before hashes, to appear in
  apply-time revalidation, and to leave the post-apply snapshot matching the
  local target surface.
- Negative cases keep the release evidence non-ok when the taxonomy is changed
  away from `post_tag`, when the taxonomy mutation precondition hash no longer
  matches the mutation hashes, or when apply-time revalidation omits the
  taxonomy resource key.

## Observed target shape

```json
{
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72941\"]",
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72931\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71002|term_taxonomy_id:72941\"]",
  "termTaxonomyId": 72941,
  "termId": 72931,
  "taxonomy": "post_tag",
  "preconditionLive": true,
  "applyRevalidated": true,
  "finalMatchesLocal": true
}
```

## Current unmapped WordPress surfaces

`post_tag` is covered by the release-verifier carry-through proof for the core
post-object taxonomy path. The remaining intentionally unmapped or fail-closed
WordPress surfaces stay documented here:

- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent menu taxonomy
  `wp_term_relationships` rows.
- Custom/plugin taxonomy rows without an explicit equivalent identity-map target.
- `wp_posts.post_type = nav_menu_item` rows and menu item graph metadata such as
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_object`,
  `_menu_item_type`, and `menu_item_parent`.
- Unsupported post graph rows such as `revision` and `wp_navigation`.
- Serialized block references in post content or excerpts that require
  parser-aware graph identity mapping.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only target/change evidence unless a future focused proof adds a
supported identity map or owner/driver boundary.

## Validation commands

```sh
node --check test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js
node --test test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js
node --test --test-name-pattern='post_tag|RPP-0390' test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js test/local-production-complex-site-proof.test.js
node --test test/graph-mapping-inventory.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0317-serialized-block-reference-detection.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0390 test: 3 subtests, 0 failures.
Syntax check, adjacent post_tag release-verifier selection, documented-unmapped
graph-identity tests, checklist completion lint, touched-document artifact
redaction scan, and diff whitespace checks all returned exit code 0.

Release remains held for broader production and graph-identity gates outside
this focused post_tag release-verifier evidence slice.
