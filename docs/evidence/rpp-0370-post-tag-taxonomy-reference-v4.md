# RPP-0370 post_tag taxonomy reference v4 evidence

Date: 2026-05-30
Lane: RPP-0370 post_tag taxonomy reference, variant 4
Checklist item: RPP-0370 — Add focused regression coverage for post_tag taxonomy
reference, variant 4.

## Scope

This slice adds one focused planner/apply regression test, this evidence note,
and the single RPP-0370 checklist update. It does not modify production code,
generated harness files, public progress surfaces, release publish artifacts,
auth, recovery, storage, or release-verifier files.

The proof is local and synthetic. It does not claim production-backed proof for
the post_tag surface.

## Evidence added

- `test/rpp-0370-post-tag-taxonomy-reference-v4.test.js` proves the mapped
  post_tag taxonomy-reference path. A local tag term and local
  `wp_term_taxonomy` row are mapped to remote tag rows with explicit
  `wordpressGraphIdentityMap` evidence. The dependent
  `wp_term_relationships.term_taxonomy_id` reference is rewritten from the local
  term-taxonomy id to the remote term-taxonomy id, the source relationship row is
  not planned, and the rewritten mutation carries a live-remote precondition.
- The same test proves the fail-closed path when a post_tag term-taxonomy map is
  declared without equivalent term evidence. The planner blocks the
  `wp_term_taxonomy` row and its dependent relationship, emits hash-only
  `stale-wordpress-graph-identity` evidence, and `applyPlan()` refuses with
  `PLAN_NOT_READY` before mutating the remote snapshot.

## Observed target shapes

Explicit identity-map rewrite:

```json
{
  "sourceTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:37035\"]",
  "targetTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:47035\"]",
  "relationshipRewrite": {
    "from": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:37035\"]",
    "to": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:47035\"]",
    "field": "term_taxonomy_id",
    "plannedValue": 47035
  },
  "taxonomy": "post_tag",
  "precondition": "live-remote"
}
```

Fail-closed missing-equivalence case:

```json
{
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:37035\"]",
  "dependentReference": "wp_term_relationships.term_taxonomy_id",
  "targetSupport": "stale-wordpress-graph-identity",
  "reason": "identity map target is not equivalent after identity rewriting",
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false,
  "hashOnlyEvidence": true
}
```

## Remaining unmapped WordPress surfaces

This focused regression covers post_tag term-taxonomy references when explicit
identity-map evidence proves the remote target, and when an incomplete map must
fail closed. It does not prove production movement, term natural-identity
matching by slug/name, or plugin/custom taxonomy surfaces. Custom taxonomies,
`nav_menu`, `nav_menu_item`, `wp_navigation`, and other plugin-owned taxonomy or
navigation surfaces remain outside this local RPP-0370 proof unless a separate
focused test or production-shaped verifier covers them.

## Validation commands

```sh
node --check test/rpp-0370-post-tag-taxonomy-reference-v4.test.js
node --test test/rpp-0370-post-tag-taxonomy-reference-v4.test.js
git grep -nE "post_tag|taxonomy reference|RPP-0310|RPP-0330|RPP-0350" -- test
node --test --test-name-pattern='post_tag|taxonomy reference|custom taxonomy|RPP-0309|RPP-0311' test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0370-post-tag-taxonomy-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local focused result: 2 subtests, 0 failures. The adjacent taxonomy
slice, checklist completion lint, touched-doc artifact redaction scan, and
whitespace diff checks were run locally after the focused test and checklist
line were updated.

Release remains held for broader graph-identity and production evidence gates
outside this local post_tag regression slice.
