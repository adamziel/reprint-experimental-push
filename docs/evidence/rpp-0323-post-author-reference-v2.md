# RPP-0323 post author reference v2 evidence

Date: 2026-05-30
Lane: RPP-0323 post author reference, variant 2
Checklist item: RPP-0323 - Prove post author reference, variant 2.

## Scope

This is focused local generated-harness proof for `wp_posts.post_author`
graph identity handling. It does not change generated harness sources,
progress artifacts, production release gates, auth, recovery, storage, or
release-verifier code.

## Proof surface

`test/rpp-0323-post-author-reference-v2.test.js` consumes the existing
generated harness post-author target coverage and proves:

- the generated summary exposes 20 `postAuthorGraph` target cases, with one
  ready same-plan author case and one stale author case in each tier 0 through
  9;
- every ready case plans the same-plan `wp_users` author row and authored
  `wp_posts` row with live-remote preconditions, applies both local rows, and
  rejects a stale replay with `PRECONDITION_FAILED` before the mutation hook;
- every stale case blocks the authored post with
  `stale-wordpress-graph-identity`, records `wp_posts.post_author` reference
  evidence to `wp_users`, emits no stale authored-post mutation, and refuses
  `applyPlan` with `PLAN_NOT_READY` before mutation; and
- serialized proof evidence is hash-only and excludes generated author titles,
  logins, display names, and remote drift markers.

The proof remains local generated-model evidence only. Final release posture is
still `NO-GO` until the separate production-backed release evidence is supplied.

## Validation

Focused validation run:

```sh
node --check test/rpp-0323-post-author-reference-v2.test.js
node --test test/rpp-0323-post-author-reference-v2.test.js
node --test --test-name-pattern=RPP-0303 test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0383 test/rpp-0383-post-author-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0323-post-author-reference-v2.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0323 proof reported 1
subtest and 0 failures, adjacent RPP-0303 generated-harness coverage reported 1
subtest and 0 failures, adjacent RPP-0383 release-verifier coverage reported 3
subtests and 0 failures, the scoped artifact redaction scan returned
`"ok": true`, and `git diff --check` reported no whitespace errors.
