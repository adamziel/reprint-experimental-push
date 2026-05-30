# RPP-0379 cross-table create batch mapping, variant 4 evidence

Date: 2026-05-30
Lane: RPP-0379 cross-table create batch mapping, variant 4
Checklist item: RPP-0379 — Add focused regression coverage for cross-table create batch mapping, variant 4.

## Scope

This focused slice adds regression coverage only for the graph-identity
cross-table create batch target. It does not modify generated harnesses,
progress surfaces, release docs, RPP-0378, or RPP-0380.

## Evidence added

- `test/rpp-0379-cross-table-create-batch-mapping-v4.test.js` builds a local
  `wp_posts` create plus a same-plan `wp_postmeta` create whose composite row ID
  and `post_id` point at that new post.
- The test plans the batch, applies it to the remote snapshot, and asserts the
  applied `wp_postmeta` row still points at `ID:71701` after apply.
- The same test feeds the real post/postmeta plan mutations into
  `buildComplexSiteReleaseEvidence()` with the local-production postmeta graph
  shape enabled. The evidence must keep both batch resources in the release
  plan, require live preconditions, include both resource keys in apply
  revalidation, and report `finalMatchesLocal`.
- A negative subtest swaps the postmeta resource out of apply revalidation while
  preserving the verified count, proving the local-production evidence fails
  closed on the specific cross-table target rather than only checking batch
  size.

## Observed target shape

```json
{
  "postResourceKey": "row:[\"wp_posts\",\"ID:71701\"]",
  "postmetaResourceKey": "row:[\"wp_postmeta\",\"post_id:71701:meta_key:reprint_push_postmeta_post_fixture\"]",
  "relationship": "wp_postmeta.post_id",
  "postmetaPostId": 71701,
  "localProductionVerifier": {
    "postMutationPlanned": true,
    "postmetaMutationPlanned": true,
    "preconditionLive": true,
    "applyRevalidated": true,
    "finalMatchesLocal": true
  }
}
```

## Validation commands

```sh
node --check test/rpp-0379-cross-table-create-batch-mapping-v4.test.js
node --test test/rpp-0379-cross-table-create-batch-mapping-v4.test.js
node --test --test-name-pattern 'same-plan post and attachment|real Playground postmeta|same-plan taxonomy closure|same-plan comment and user graph closure' test/push-planner.test.js
node --test --test-name-pattern 'explicit WordPress graph identity map|blocks explicit WordPress graph identity maps|comment parent thread references through explicit WordPress graph identity maps' test/push-planner.test.js
node --test test/local-production-complex-site-proof.test.js
node --test test/graph-mapping-inventory.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0379-cross-table-create-batch-mapping-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local results:

- New focused RPP-0379 test: 2 subtests, 0 failures.
- Adjacent same-plan planner graph closure run: 4 subtests, 0 failures.
- Adjacent explicit identity-map planner run: 3 subtests, 0 failures.
- Adjacent local-production verifier graph run: 20 subtests, 0 failures.
- Adjacent graph mapping inventory run: 2 subtests, 0 failures.
- Checklist lint and artifact redaction scan both returned `ok: true`.
