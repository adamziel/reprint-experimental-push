# RPP-0331 custom taxonomy fail-closed reference v2 evidence

Date: 2026-05-30
Lane: RPP-0331 custom taxonomy fail-closed reference, variant 2
Checklist item: RPP-0331 — Prove custom taxonomy fail-closed reference, variant 2.

## Scope

This focused slice adds local planner regression coverage for custom taxonomy
graph identity. It stays within the RPP-0331 test and this evidence note. It
does not modify source behavior, generated harnesses, release scripts, public
progress surfaces, or checklist files.

## Evidence added

- `test/rpp-0331-custom-taxonomy-fail-closed-reference-v2.test.js` proves that
  an unsupported `product_cat` `wp_term_taxonomy` row and its dependent
  `wp_term_relationships.term_taxonomy_id` reference fail closed when no stable
  target identity is proven. The planner emits
  `stale-wordpress-graph-identity` blockers for both unsafe resources, does not
  plan either custom taxonomy mutation, and `applyPlan()` refuses the blocked
  plan with `PLAN_NOT_READY` before mutating the remote snapshot.
- The same test proves the accepted mapper path for the same custom taxonomy
  surface. Explicit WordPress graph identity-map rows bind the local source term
  and term-taxonomy rows to equivalent remote target rows. The planner records
  `map-local-identity-to-remote` decisions for the sources, preserves the remote
  targets, rewrites the dependent relationship to the proven remote
  `term_taxonomy_id`, and applies only the rewritten relationship with
  live-remote preconditions.
- The fail-closed blocker and target reference evidence is hash-only for the
  private custom taxonomy row contents. Assertions require SHA-256-shaped hashes
  and verify that raw term names, slugs, and descriptions are absent from the
  serialized blocker/reference evidence.

## Observed target shapes

Unsupported custom taxonomy without stable target proof:

```json
{
  "taxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:33154\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:331001|term_taxonomy_id:33154\"]",
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
  "sourceTerm": "row:[\"wp_terms\",\"term_id:33144\"]",
  "targetTerm": "row:[\"wp_terms\",\"term_id:33244\"]",
  "sourceTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:33154\"]",
  "targetTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:33254\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "relationshipRewrite": {
    "from": "row:[\"wp_term_relationships\",\"object_id:331001|term_taxonomy_id:33154\"]",
    "to": "row:[\"wp_term_relationships\",\"object_id:331001|term_taxonomy_id:33254\"]",
    "field": "term_taxonomy_id",
    "plannedValue": 33254
  },
  "precondition": "live-remote"
}
```

The proof keeps custom/plugin taxonomy movement fail-closed by default while
pinning the supported path: the mapper may carry the dependent relationship only
after the identity map proves a stable equivalent remote taxonomy target.

## Validation commands

```sh
node --check test/rpp-0331-custom-taxonomy-fail-closed-reference-v2.test.js
node --test test/rpp-0331-custom-taxonomy-fail-closed-reference-v2.test.js
node --test test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/rpp-0331-custom-taxonomy-fail-closed-reference-v2.test.js test/rpp-0371-custom-taxonomy-fail-closed-reference-v4.test.js test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0331-custom-taxonomy-fail-closed-reference-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0331 test reported 2 subtests, 0 failures; adjacent custom taxonomy tests
reported 9 subtests, 0 failures; artifact redaction scan for this evidence
returned `ok:true`; and whitespace diff check passed.

## Release posture

This lane is local planner evidence only. It is not live production-backed
release evidence and does not satisfy the broader final release boundary.
Release remains `NO-GO` until separate production evidence satisfies the full
release gate set.
