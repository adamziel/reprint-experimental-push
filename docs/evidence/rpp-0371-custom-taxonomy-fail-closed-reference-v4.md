# RPP-0371 custom taxonomy fail-closed reference v4 evidence

Date: 2026-05-30
Lane: RPP-0371 custom taxonomy fail-closed reference, variant 4
Checklist item: RPP-0371 — Add focused regression coverage for custom taxonomy fail-closed reference, variant 4.

## Scope

This is a local focused regression slice for custom taxonomy graph identity. It
adds no production implementation and does not touch public progress surfaces,
generated harness files, auth, recovery, storage, release-verifier files, or
release publish artifacts.

## Evidence added

- `test/rpp-0371-custom-taxonomy-fail-closed-reference-v4.test.js` keeps an
  unsupported `product_cat` `wp_term_taxonomy` target fail-closed when no
  explicit WordPress graph identity map proves the target. The planner emits
  `stale-wordpress-graph-identity` blockers for the taxonomy row and the
  dependent `wp_term_relationships.term_taxonomy_id` reference, does not plan
  either unsafe mutation, and `applyPlan()` refuses with `PLAN_NOT_READY` before
  the remote snapshot changes.
- The same test proves the accepted mapper path when explicit identity-map rows
  bind the local custom taxonomy term and term-taxonomy rows to equivalent
  remote target rows. The planner records `map-local-identity-to-remote` for the
  source rows, preserves the remote target rows, rewrites the relationship from
  `term_taxonomy_id:37154` to `term_taxonomy_id:37254`, and applies the
  rewritten relationship with live-remote preconditions.
- The fail-closed evidence is hash-only for the unsupported target and dependent
  reference. The assertions check SHA-256-shaped hashes and verify that raw term
  name, slug, and description strings are absent from blocker and reference
  evidence.

## Observed target shapes

Unsupported custom taxonomy without a proven identity map:

```json
{
  "taxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:37154\"]",
  "relationshipKey": "wp_term_relationships.term_taxonomy_id",
  "relationshipType": "term-relationship-taxonomy",
  "targetSupport": "stale-wordpress-graph-identity",
  "plannedTaxonomyMutation": false,
  "plannedRelationshipMutation": false,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false,
  "evidenceFormat": "hash-only"
}
```

Explicit stable target mapping for the same custom taxonomy class:

```json
{
  "sourceTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:37154\"]",
  "targetTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:37254\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "relationshipRewrite": {
    "from": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:37154\"]",
    "to": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:37254\"]",
    "field": "term_taxonomy_id",
    "plannedValue": 37254
  },
  "precondition": "live-remote"
}
```

This proof is local/generated only; it is not production-backed release proof.
It keeps unsupported custom taxonomy references fail-closed by default while
pinning the supported identity-map rewrite behavior for stable remote targets.

## Validation commands

```sh
node --check test/rpp-0371-custom-taxonomy-fail-closed-reference-v4.test.js
node --test test/rpp-0371-custom-taxonomy-fail-closed-reference-v4.test.js
if command -v rg >/dev/null 2>&1; then rg "custom taxonomy|fail-closed|RPP-0311|RPP-0331|RPP-0351" test; else grep -RInE "custom taxonomy|fail-closed|RPP-0311|RPP-0331|RPP-0351" test; fi
node --test --test-name-pattern='RPP-0311|RPP-0331|RPP-0371|custom taxonomy' test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/rpp-0371-custom-taxonomy-fail-closed-reference-v4.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0371-custom-taxonomy-fail-closed-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0371 command: 2 subtests, 0 failures.
The adjacent custom-taxonomy graph slice, checklist completion lint, touched-doc
artifact redaction scan, unstaged whitespace check, and staged whitespace check
were run locally after the test, evidence file, and checklist line were updated;
all returned exit code 0. The discovery step used the grep fallback because
`rg` was not installed in this worktree image.
