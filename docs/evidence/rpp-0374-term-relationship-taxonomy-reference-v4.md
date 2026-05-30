# RPP-0374 term relationship taxonomy reference variant 4 evidence

Date: 2026-05-30
Lane: RPP-0374 term relationship taxonomy reference, variant 4
Checklist item: RPP-0374 — Add focused regression coverage for term relationship taxonomy reference, variant 4.

## Scope

This slice adds focused local regression coverage for the
`wp_term_relationships.term_taxonomy_id` reference to its same-plan
`wp_term_taxonomy` target. It stays inside the RPP-0374 test, this evidence
note, and the single RPP-0374 checklist line. It does not change generated
harness files, release docs, progress surfaces, production planner/apply code,
or unrelated RPP task files.

## Evidence added

- `test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js` builds a
  minimal local/base/remote site where the relationship object post is stable
  and the local edit creates a category term, the matching `wp_term_taxonomy`
  row, and a `wp_term_relationships` row keyed by
  `object_id:71001|term_taxonomy_id:72911`.
- The focused planner/apply test proves the plan is ready, carries live-remote
  preconditions for every mutation, plans the term, taxonomy, and relationship
  rows, and applies the relationship with `term_taxonomy_id:72911` intact.
- The local-production verifier regression builds a release-verifier-shaped
  summary from the ready plan and post-apply site, runs
  `buildComplexSiteReleaseEvidence()`, and asserts that the apply revalidation
  covers every mutation while the relationship-specific evidence carries
  `wp_term_relationships.term_taxonomy_id` to
  `row:["wp_term_taxonomy","term_taxonomy_id:72911"]` through the final
  applied snapshot.
- A tampered summary changes the relationship mutation and post-apply evidence
  to `term_taxonomy_id:72912`; the focused carry-through evidence flips false,
  proving the regression guard detects a lost taxonomy target.

## Observed target shape

```json
{
  "relationshipKey": "wp_term_relationships.term_taxonomy_id",
  "relationshipType": "term-relationship-taxonomy",
  "resourceKey": "row:[\"wp_term_relationships\",\"object_id:71001|term_taxonomy_id:72911\"]",
  "targetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "mutationPlanned": true,
  "targetMutationPlanned": true,
  "carriesTaxonomyTarget": true,
  "preconditionLive": true,
  "applyRevalidated": true,
  "finalCarriesTaxonomyTarget": true,
  "allThroughApply": true
}
```

## Validation commands

```sh
node --check test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js
node --test test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js
node --test --test-name-pattern='RPP-0374|RPP-0311|explicit WordPress graph identity map|same-plan taxonomy closure|post_tag taxonomy closure|blocks a taxonomy relationship|nav_menu taxonomy|custom taxonomy|term relationship|taxonomy relationship' test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0374-term-relationship-taxonomy-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0374 test: 2 subtests, 0 failures.
The adjacent graph-identity command above exercised the focused RPP-0374 test,
RPP-0311 custom taxonomy coverage, and matching taxonomy/relationship cases in
`test/push-planner.test.js`; it returned exit code 0 locally. Checklist lint,
touched-doc artifact redaction scan, and whitespace checks returned exit code 0
locally.

Release remains held for broader graph-identity and production evidence gates
outside this focused term relationship taxonomy reference slice.
