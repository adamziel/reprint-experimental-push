# RPP-0309 category term taxonomy reference evidence

Date: 2026-05-29
Lane: RPP-0309 category term taxonomy reference, variant 1
Checklist item: RPP-0309 — Implement category term taxonomy reference, variant 1.

## Scope

This slice stays inside graph-identity local-production verifier proof code,
focused RPP-0309 tests, this evidence note, and the single RPP-0309 checklist
line. It does not touch generated-harness target additions, merge invariants,
plugin-driver behavior, executor-auth routes, recovery/storage, topology,
release-ops, or public progress surfaces.

## Evidence added

- `scripts/playground/local-production-complex-site-proof.js` now records the
  category `wp_term_taxonomy` proof target explicitly. The planner proof fails
  unless `row:["wp_term_taxonomy","term_taxonomy_id:72911"]` is planned as a
  `wp_term_taxonomy` mutation carrying `term_taxonomy_id:72911`,
  `term_id:72901`, and `taxonomy:"category"` from the local fixture.
- The local-production release evidence parser now treats the category taxonomy
  target as required when `taxonomyGraph` is enabled. It fails closed unless the
  same `wp_term_taxonomy` mutation is present in the release verifier plan, has
  a live-remote precondition whose hash matches the mutation base/remote-before
  hashes, appears in apply-time revalidation, and the post-apply snapshot still
  matches the local target surface.
- `test/rpp-0309-category-term-taxonomy-reference.test.js` adds focused
  synthetic local-production coverage for the planner proof, the apply
  carry-through evidence, and a negative case where changing the planned
  `term_id` makes the release evidence non-ok.

## Observed target shape

The focused RPP-0309 proof asserts this hash-only target summary:

```json
{
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "termTaxonomyId": 72911,
  "termId": 72901,
  "taxonomy": "category",
  "preconditionLive": true,
  "applyRevalidated": true,
  "finalMatchesLocal": true
}
```

The focused fail-closed case mutates the planned `term_id` away from `72901`;
`buildComplexSiteReleaseEvidence()` then returns `ok: false` and clears the
`taxonomyGraphTermTaxonomyCarriedInReleasePlan` invariant before release
movement could be considered valid.

## Validation commands

```sh
node --test test/rpp-0309-category-term-taxonomy-reference.test.js
node --check scripts/playground/local-production-complex-site-proof.js && node --check test/rpp-0309-category-term-taxonomy-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0309-category-term-taxonomy-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0309 test: 3 subtests, 0 failures.
Syntax checks passed for the touched verifier proof and focused test files.
Checklist completion lint, artifact redaction scan, and whitespace diff checks
passed locally.

A broader existing `test/local-production-complex-site-proof.test.js` focused
run was attempted first, but the current lane fails before running any RPP-0309
assertions because that pre-existing test imports
`buildPostAuthorIdentityMapProof`, which is not exported by
`scripts/playground/local-production-complex-site-proof.js` at this lane head.
The RPP-0309 coverage was therefore isolated in the new focused test file above.

Release remains held for broader graph-identity and production evidence gates
outside this local category term-taxonomy slice.
