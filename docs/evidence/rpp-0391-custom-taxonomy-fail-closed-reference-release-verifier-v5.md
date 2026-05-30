# RPP-0391 custom taxonomy fail-closed reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0391 custom taxonomy fail-closed reference release-verifier carry-through, variant 5
Checklist item: RPP-0391 — Carry through the release verifier for custom taxonomy fail-closed reference, variant 5.

## Scope

This focused slice carries the RPP-0311 custom taxonomy graph-identity behavior
through local release-verifier evidence. It keeps unsupported custom taxonomy
movement fail-closed unless an explicit WordPress graph identity map proves the
remote target row and lets the mapper rewrite the dependent relationship.

The proof is local/support-only. It does not claim live production-backed
release evidence and keeps the release gate at `NO-GO`.

## Proof surface

`test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js`
proves three release-verifier-facing cases:

- without identity-map evidence, a `product_cat` `wp_term_taxonomy` row and its
  dependent `wp_term_relationships.term_taxonomy_id` reference produce
  `stale-wordpress-graph-identity` blockers, no unsafe taxonomy or relationship
  mutation is planned, and `applyPlan()` refuses the blocked plan with
  `PLAN_NOT_READY` before any remote mutation;
- with explicit `wp_terms` and `wp_term_taxonomy` identity-map rows, the planner
  records `map-local-identity-to-remote` decisions for the source rows,
  preserves the remote target rows, rewrites the relationship from the local
  `term_taxonomy_id` to the proven remote `term_taxonomy_id`, and carries a
  live-remote precondition plus apply-time revalidation for the rewritten row;
  and
- if release-verifier apply revalidation omits the rewritten relationship row,
  the evidence remains support-only `NO-GO` and marks the carry-through as not
  accepted.

The test also checks that release-verifier evidence is hash-only for private
term/taxonomy content: it records resource keys, IDs, decision labels, rewrite
metadata, hashes, and revalidation status without raw term names, slugs, or
custom taxonomy descriptions.

## Observed target shapes

Fail-closed custom taxonomy reference without identity-map evidence:

```json
{
  "scenario": "fail-closed-without-custom-taxonomy-identity-map",
  "status": "blocked",
  "verdict": "CUSTOM_TAXONOMY_REFERENCE_FAIL_CLOSED",
  "unsupportedSurface": "product_cat",
  "mutationAttempted": false,
  "applyRefusalCode": "PLAN_NOT_READY",
  "taxonomyBlocker": "stale-wordpress-graph-identity",
  "relationshipType": "term-relationship-taxonomy",
  "relationshipTargetSupport": "stale-wordpress-graph-identity"
}
```

Mapped custom taxonomy release-verifier carry-through:

```json
{
  "scenario": "identity-map-rewrites-custom-taxonomy-relationship",
  "status": "support_only",
  "verdict": "CUSTOM_TAXONOMY_REFERENCE_REWRITTEN_SUPPORT_ONLY",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "relationshipType": "term-relationship-taxonomy",
  "rewrittenResourceKey": "row:[\"wp_term_relationships\",\"object_id:391001|term_taxonomy_id:391154\"]",
  "plannedTermTaxonomyId": 391154,
  "precondition": "live-remote",
  "applyRevalidated": true,
  "releaseGate": "NO-GO"
}
```

The release-verifier proof therefore keeps custom/plugin taxonomy movement
blocked by default while allowing the mapper to rewrite a dependent reference
only when the identity map proves the stable remote target.

## Focused verification observed locally

```sh
node --check test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js
node --test test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js
node --test test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0391-custom-taxonomy-fail-closed-reference-release-verifier-v5.test.js
git diff --check
git diff --cached --check
```

Observed local result after validation: all commands exited 0. The focused
RPP-0391 test reported 3 subtests ok and 0 failed; the adjacent taxonomy graph
identity slice reported 8 subtests ok and 0 failed.

## Release posture

This lane adds local release-verifier carry-through evidence only. The proof is
support-only and productionBacked `false`; final release remains `NO-GO` until
separate live production evidence satisfies the broader release boundary.
