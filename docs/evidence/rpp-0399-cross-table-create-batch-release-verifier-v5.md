# RPP-0399 cross-table create batch release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0399 cross-table create batch mapping, variant 5
Checklist item: RPP-0399 — Carry through the release verifier for cross-table create batch mapping, variant 5.

## Scope

This adds local production-shaped release-verifier carry-through for a same-plan
cross-table create batch. The proof is support-only and keeps final release
posture at NO-GO because it is not separate live production-owned release
evidence.

## Proof surface

`test/rpp-0399-cross-table-create-batch-release-verifier-v5.test.js` verifies
that `production-shaped-release-verify.mjs` now emits
`graphIdentity.crossTableCreateBatch` evidence. The proof builds and applies a
six-row create batch:

- `wp_posts`
- `wp_postmeta`
- `wp_terms`
- `wp_term_taxonomy`
- `wp_term_relationships`
- `wp_termmeta`

The proof requires all six mutations to be `create` mutations with
`live-remote` preconditions, carries five reference edges across the batch, runs
apply with a durable journal, verifies every row was created and the final
remote matches local, and proves stale replay fails with `PRECONDITION_FAILED`
before mutation. The emitted evidence is hash-only and excludes raw post,
postmeta, term, and termmeta payloads.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0399-cross-table-create-batch-release-verifier-v5.test.js
node --test test/rpp-0399-cross-table-create-batch-release-verifier-v5.test.js
node --test --test-name-pattern 'same-plan post and attachment graph closure|maps real Playground postmeta|plans a safe same-plan taxonomy closure|plans a safe same-plan post_tag taxonomy closure|blocks a taxonomy relationship|RPP-0374' test/push-planner.test.js test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js
node --test test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node --test --test-name-pattern 'complex-site planner proof covers real taxonomy graph closure|complex-site release evidence proves post_tag taxonomy carries through apply|complex-site release evidence extracts release verifier receipts' test/local-production-complex-site-proof.test.js
REPRINT_PUSH_AUTHENTICATED_REQUEST_TIMEOUT_MS=180000 timeout 600s npm run verify:release:local-production:complex-site:taxonomy-graph
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0399-cross-table-create-batch-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused result: syntax checks exited 0. The RPP-0399 focused test
reported 3 subtests ok. The adjacent graph planner/RPP-0374 slice reported 7
subtests ok. The adjacent RPP-0485/RPP-0486 release-verifier slice reported 8
subtests ok. The adjacent local-production graph evidence unit slice reported 3
subtests ok.

The local production taxonomy graph verifier command reached apply and carried
the cross-table taxonomy create batch through the release verifier: the planner
proof reported `taxonomyGraphEvidence.allResourcesPlanned: true`, the live
release verifier plan contained 26 ready mutations, `apply.status` was `200`,
`apply.applied` was `26`, and before-first-mutation revalidation included the
`wp_terms`, `wp_term_taxonomy`, `wp_term_relationships`, and `wp_termmeta`
resource keys. The command then exited 1 at the separate
`PRESERVED_REMOTE_RETRY_REQUIRED` boundary, so this is apply carry-through
evidence only, not release movement.

## Release posture

NO-GO for final release movement from this slice alone. The proof is local and
production-shaped; production-backed release evidence is still required for
promotion.
