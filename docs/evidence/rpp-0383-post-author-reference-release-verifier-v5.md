# RPP-0383 post author reference release verifier v5 evidence

Date: 2026-05-30

## Scope

Focused local release-verifier carry-through evidence for the WordPress
`wp_posts.post_author` graph reference, variant 5. This slice does not change
generated harness files or public progress surfaces.

## Proof surface

`test/rpp-0383-post-author-reference-release-verifier-v5.test.js` keeps the
existing generated harness as the source of truth. It imports
`generatePushHarnessCases()`, `runGeneratedPushHarness()`, and
`validateGeneratedCase()`, then builds a release-verifier-shaped evidence
envelope for the generated post-author target.

The proof asserts:

- generated target coverage has 20 post-author graph cases: 10 ready and 10
  stale/non-ready cases, with two target cases in each tier 0 through 9;
- every ready case plans both the `wp_users` author row and the authored
  `wp_posts` row, applies the same-plan `post_author` value, preserves
  unplanned remote resources, and rejects stale replay with
  `PRECONDITION_FAILED` before mutation;
- every stale case refuses the authored post with
  `stale-wordpress-graph-identity`, records `wp_posts.post_author` reference
  evidence to `wp_users`, includes target hashes, and keeps the remote unchanged
  after `PLAN_NOT_READY`; and
- the release-verifier evidence is hash-only for site data and excludes the
  generated author row titles, logins, display names, and remote drift marker.

The evidence envelope remains local-generated and labels the release gate as
`NO-GO`; it is not a live production release proof.

## Focused verification observed locally

```sh
node --check test/rpp-0383-post-author-reference-release-verifier-v5.test.js
node --test test/rpp-0383-post-author-reference-release-verifier-v5.test.js
node --test --test-name-pattern=RPP-0303 test/generated-push-harness.test.js
node --test --test-name-pattern 'post author|post_author|post-author' test/push-planner.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0383-post-author-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result in this worktree: all commands exited 0. The focused RPP-0383
test reported 3 subtests ok and 0 failed. The adjacent RPP-0303 generated
post-author slice reported 1 subtest ok and 0 failed. The adjacent planner
post-author slice reported 1 subtest ok and 0 failed. The full generated push
harness reported 85 subtests ok and 0 failed. Checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true`.

## Release posture

This is a local generated-harness release-verifier carry-through slice only.
Final release remains `NO-GO` without the broader production-backed release
verification evidence.
