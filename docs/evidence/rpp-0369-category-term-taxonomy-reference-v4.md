# RPP-0369 category term taxonomy reference v4 evidence

Date: 2026-05-30
Lane: RPP-0369 category term taxonomy reference, variant 4
Checklist item: RPP-0369 — Add focused regression coverage for category term taxonomy reference, variant 4.

## Scope

This slice adds one focused local regression test for the existing planner/apply
path, this evidence note, and the single RPP-0369 checklist line. It does not
change production verifier code, generated harnesses, progress surfaces,
authentication, recovery, storage, release-verifier artifacts, or publish
outputs.

## Evidence added

- `test/rpp-0369-category-term-taxonomy-reference-v4.test.js` builds a small
  source/local/remote fixture where local creates a category `wp_terms` row, its
  `wp_term_taxonomy` row, a dependent `wp_term_relationships` row, and
  `wp_termmeta`.
- The focused planner proof asserts the category target
  `row:["wp_term_taxonomy","term_taxonomy_id:72911"]` is a ready `put`
  mutation carrying `term_taxonomy_id:72911`, `term_id:72901`, and
  `taxonomy:"category"` with live-remote precondition hashes.
- The focused apply proof applies the ready plan to the remote snapshot and
  checks the applied `wp_term_taxonomy` resource hash equals the planned local
  hash. A negative case changes the applied target hash and verifies the local
  hash-only evidence summary returns `ok:false`.
- The test-local evidence summary contains resource IDs, taxonomy type, and
  hashes only; it asserts the raw fixture strings used in rows do not appear in
  serialized evidence.

## Hash-only target summary

The focused RPP-0369 test asserts this target shape locally:

```json
{
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71001|term_taxonomy_id:72911\"]",
  "termmetaResourceKey": "row:[\"wp_termmeta\",\"meta_id:72921\"]",
  "termTaxonomyId": 72911,
  "termId": 72901,
  "taxonomy": "category",
  "hashes": {
    "base": "<64 lowercase hex>",
    "remoteBefore": "<64 lowercase hex>",
    "precondition": "<64 lowercase hex>",
    "local": "<64 lowercase hex>",
    "applied": "<64 lowercase hex>"
  },
  "invariants": {
    "mutationPresent": true,
    "mutationTargetsCategoryTaxonomy": true,
    "mutationCarriesTermReference": true,
    "preconditionLive": true,
    "applyCarriedTarget": true
  }
}
```

This is local/generated evidence only; it is not production-backed proof.
Release remains held for broader graph-identity and production evidence gates
outside this focused regression slice.

## Validation commands

```sh
node --check test/rpp-0369-category-term-taxonomy-reference-v4.test.js
node --test test/rpp-0369-category-term-taxonomy-reference-v4.test.js
nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#ripgrep --command rg "category term taxonomy|term_taxonomy|RPP-0309|RPP-0329|RPP-0349" test
node --test test/rpp-0309-category-term-taxonomy-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0369-category-term-taxonomy-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0369 test: 2 subtests, 0 failures.
The adjacent RPP-0309 category term taxonomy slice also passed locally.
Checklist completion lint, artifact redaction scan, syntax check, and diff
whitespace checks passed locally.
