# RPP-0389 category term taxonomy release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0389 category term taxonomy reference release-verifier carry-through, variant 5
Checklist item: RPP-0389 — Carry through the release verifier for category term taxonomy reference, variant 5.

## Scope

This is a focused local release-verifier regression slice for the built-in
category `wp_term_taxonomy` graph target. It adds only the RPP-0389 test,
this evidence note, and the assigned checklist line. It does not alter the
planner, generated harness fixtures, release scripts, progress surfaces, or
neighboring RPP-0388/RPP-0390 files.

## Proof surface

`test/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.test.js`
constructs a ready local-production-shaped plan containing the exact category
taxonomy graph closure:

```json
{
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "termTaxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71001|term_taxonomy_id:72911\"]",
  "termmetaResourceKey": "row:[\"wp_termmeta\",\"meta_id:72921\"]"
}
```

The positive assertion feeds that concrete ready plan through
`buildComplexSiteReleaseEvidence()` in the same shape emitted by the local
production release verifier. It requires the release evidence to show the
`wp_term_taxonomy` mutation:

- is present in `releaseProof.planObject.mutations` as `wp_term_taxonomy` row
  `term_taxonomy_id:72911`;
- carries `term_id:72901` and `taxonomy:"category"`;
- has a live-remote precondition whose hash matches the mutation base and
  remote-before hashes;
- appears in apply-time revalidation before the first mutation; and
- reports the post-apply surface as matching the local target.

The negative assertion removes only the category taxonomy resource key from the
apply revalidation list. The release evidence then returns `ok: false` while
leaving the plan/precondition checks true, proving this slice fails closed
specifically when the target is not carried through apply.

The focused test also checks that the returned release evidence remains
hash-only for private category/termmeta fixture payloads.

## Focused verification observed locally

```sh
node --check test/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.test.js
node --test test/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.test.js
node --test test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.test.js
node --test --test-name-pattern='complex-site planner proof covers real taxonomy graph closure|complex-site release evidence extracts release verifier receipts and gates from noisy command output|complex-site release evidence proves post_tag taxonomy carries through apply|complex-site release evidence fails closed when post_tag taxonomy is changed' test/local-production-complex-site-proof.test.js
node --test --test-name-pattern='plans a safe same-plan taxonomy closure for a category term|wp_term_taxonomy graph' test/push-planner.test.js test/generated-push-harness.test.js
```

Observed result: each command exited 0. The focused RPP-0389 test reported 2
subtests ok, 0 failed. The adjacent category release-evidence run reported 5
subtests ok, 0 failed; the local-production taxonomy proof subset reported 4
subtests ok, 0 failed; and the planner/generated `wp_term_taxonomy` graph
subset reported 4 subtests ok, 0 failed.

Release checklist and artifact hygiene commands were also run after this file
and the checklist line were updated:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

## Release posture

This lane is local release-verifier carry-through evidence for the category
term taxonomy reference. It proves the local production verifier evidence path
requires the target through apply, but it does not claim a live external
production release run beyond this focused local proof.
