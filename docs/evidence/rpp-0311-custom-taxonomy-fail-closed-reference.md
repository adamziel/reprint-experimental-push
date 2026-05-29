# RPP-0311 custom taxonomy fail-closed reference evidence

Date: 2026-05-29
Lane: RPP-0311 custom taxonomy fail-closed reference, variant 1
Checklist item: RPP-0311 — Implement custom taxonomy fail-closed reference, variant 1.

## Scope

This slice stays inside focused graph-identity proof for custom taxonomy
`wp_term_taxonomy` and `wp_term_relationships` references. It does not touch
public progress surfaces, generated-harness targets, merge-invariant logic,
plugin-driver behavior, executor-auth routes, recovery/storage, topology, or
release-ops code.

## Evidence added

- `test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js` proves that a
  custom taxonomy such as `product_cat` fails closed when no explicit WordPress
  graph identity map proves the target. The planner emits
  `stale-wordpress-graph-identity` blockers for the `wp_term_taxonomy` row and
  the dependent `wp_term_relationships.term_taxonomy_id` reference, does not
  plan either unsafe custom-taxonomy mutation, and `applyPlan()` refuses the
  blocked plan with `PLAN_NOT_READY` before mutating the remote snapshot.
- The same focused test proves the mapper path for a custom taxonomy when the
  source term and source term-taxonomy rows have explicit identity-map entries
  to equivalent remote target rows. The planner records
  `map-local-identity-to-remote` decisions for the local source rows, preserves
  the remote target rows, rewrites the dependent relationship row from
  `term_taxonomy_id:54` to `term_taxonomy_id:154`, and applies only that
  rewritten relationship with live-remote preconditions.
- The fail-closed blocker evidence is hash-only for the private custom taxonomy
  row and relationship target: serialized blocker evidence omits raw term name,
  slug, and taxonomy description while retaining SHA-256 hashes and relationship
  metadata.

## Observed target shapes

Unsupported custom taxonomy without an identity map:

```json
{
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:54\"]",
  "relationshipKey": "wp_term_relationships.term_taxonomy_id",
  "relationshipType": "term-relationship-taxonomy",
  "targetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:54\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "taxonomy": "product_cat",
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false
}
```

Explicit identity-map proof for the same custom taxonomy class:

```json
{
  "sourceTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:54\"]",
  "targetTermTaxonomy": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:154\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "relationshipRewrite": {
    "from": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:54\"]",
    "to": "row:[\"wp_term_relationships\",\"object_id:1|term_taxonomy_id:154\"]",
    "field": "term_taxonomy_id",
    "plannedValue": 154
  },
  "precondition": "live-remote"
}
```

The focused proof therefore keeps custom/plugin taxonomy movement fail-closed by
default while still allowing the graph mapper to rewrite a dependent reference
when an explicit identity map proves stable remote identity for the target.

## Validation commands

```sh
node --test test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js
node --test --test-name-pattern='RPP-0311|custom taxonomy' test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0311-custom-taxonomy-fail-closed-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0311 command: 2 subtests, 0 failures.
The broader custom-taxonomy graph command, checklist completion lint, touched-doc
artifact redaction scan, and whitespace diff check were run locally after this
file and the checklist line were updated; all returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused custom taxonomy fail-closed reference slice.
