# RPP-0396 wp_navigation fail-closed reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0396 wp_navigation fail-closed reference release-verifier carry-through, variant 5
Checklist item: RPP-0396 — Carry through the release verifier for wp_navigation fail-closed reference, variant 5.

## Scope

This slice adds focused local-production-shaped release-verifier evidence for
the `wp_navigation` graph-identity surface. It does not change planner or apply
semantics: the existing mapper is exercised in both the no-map refusal path and
the explicit identity-map rewrite path.

## Evidence added

- Focused release-verifier proof:
  `test/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.test.js`.
- Checklist line `RPP-0396` is marked checked after focused and adjacent graph
  validation returned exit code 0 locally.

## Invariants carried through

The focused proof covers three release-verifier shapes:

1. A local `wp_posts` row with `post_type = wp_navigation` and dependent
   `wp_postmeta.post_id` metadata, with no identity map, remains
   `stale-wordpress-graph-identity`. The proof records only resource keys,
   state transitions, relationship names, and hashes; `applyPlan()` refuses the
   blocked plan with `PLAN_NOT_READY` before durable-journal events or remote
   mutation.
2. With an explicit WordPress graph identity map from the local navigation row
   to a proven remote navigation row, the mapper preserves the remote
   `wp_navigation` row and rewrites the dependent `wp_postmeta.post_id`
   mutation to the remote row ID. The rewritten metadata mutation keeps a
   live-remote precondition and applies to the remote row.
3. If the release-verifier apply-revalidation evidence omits the rewritten
   metadata resource, the proof reports a blocked verifier result and keeps the
   release gate `NO-GO`.

The proof is support-only local-production-shaped evidence and does not claim a
production-backed release boundary.

## Validation commands

```sh
node --check test/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.test.js
node --test test/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0316|RPP-0396|wp_navigation' test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.test.js test/push-planner.test.js
node --test --test-name-pattern='RPP-0317|serialized block' test/rpp-0317-serialized-block-reference-detection.test.js test/push-planner.test.js
node --test test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js test/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local result for the focused RPP-0396 command: 3 subtests, 0 failures.
Release remains held for broader production-backed release evidence outside
this focused graph-identity carry-through proof.
