# RPP-0394 term relationship taxonomy release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0394 term relationship taxonomy reference release-verifier carry-through, variant 5
Checklist item: RPP-0394 — Carry through the release verifier for term relationship taxonomy reference, variant 5.

## Scope

This is a focused local release-verifier regression for
`wp_term_relationships.term_taxonomy_id`. It adds only the RPP-0394 test, this
evidence note, and the assigned checklist line. It does not change planner,
apply, generated harness, release script, progress, or adjacent RPP files.

## Proof surface

`test/rpp-0394-term-relationship-taxonomy-reference-release-verifier-v5.test.js`
builds a ready category taxonomy graph plan with:

```json
{
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "termTaxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71001|term_taxonomy_id:72911\"]",
  "termmetaResourceKey": "row:[\"wp_termmeta\",\"meta_id:72921\"]"
}
```

The positive assertion applies the ready plan locally, wraps it in the
local-production release-verifier summary shape, and feeds that summary through
`buildComplexSiteReleaseEvidence()`. It requires:

- the relationship mutation to be present as `wp_term_relationships` row
  `object_id:71001|term_taxonomy_id:72911`;
- the relationship value to carry `term_taxonomy_id:72911`;
- the target `wp_term_taxonomy` mutation to be present;
- the relationship mutation to have a live-remote precondition whose hash
  matches its mutation base and remote-before hashes;
- apply revalidation to include the relationship resource key; and
- the post-apply evidence to still carry `term_taxonomy_id:72911`.

The negative assertions tamper the relationship target and omit the relationship
resource from apply revalidation. Both cases flip the focused carry-through
proof to `allThroughApply: false`; the omitted-revalidation case also makes the
local production release evidence return `ok: false`.

## Redaction

The focused test serializes only verifier/carry-through evidence and checks that
private term name, slug, taxonomy description, and termmeta payload markers are
absent. Raw plan payloads remain outside the persisted evidence envelope.

## Validation commands

```sh
node --check test/rpp-0394-term-relationship-taxonomy-reference-release-verifier-v5.test.js
node --test test/rpp-0394-term-relationship-taxonomy-reference-release-verifier-v5.test.js
node --test test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0394-term-relationship-taxonomy-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0113|RPP-0133|RPP-0153|RPP-0173' test/generated-push-harness.test.js
node --test --test-name-pattern='same-plan taxonomy closure|term relationship|taxonomy relationship|custom taxonomy' test/push-planner.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0394-term-relationship-taxonomy-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Observed focused result after the update: the RPP-0394 test reports 2 subtests,
0 failures. Release posture remains support-only/NO-GO pending broader live
production release gates.
