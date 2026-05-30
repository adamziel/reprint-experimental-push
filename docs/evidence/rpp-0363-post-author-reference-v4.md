# RPP-0363 post author reference v4 evidence

Date: 2026-05-30
Lane: RPP-0363 post author reference, variant 4
Checklist item: RPP-0363 — Add focused regression coverage for post author reference, variant 4.

## Scope

This is local focused regression evidence for `wp_posts.post_author` graph
identity handling. It adds a standalone Node test and does not change generated
harness sources, shared production code, progress surfaces, auth, recovery,
storage, or release-verifier files.

## Proof surface

`test/rpp-0363-post-author-reference-v4.test.js` covers two focused planner and
apply paths:

- a ready authored-post create whose `post_author` points at an unchanged
  `wp_users` row; the plan emits one authored-post mutation, carries a live
  remote precondition, applies the authored post, and preserves the author row;
- a stale author target where the base/local author row is unchanged but the
  remote author row drifted; the plan blocks before mutation with
  `stale-wordpress-graph-identity`, records a `wp_posts.post_author` reference,
  and keeps only target hashes plus state transitions.

Both paths assert that raw user payload sentinel strings are absent from the
planner proof surfaces. The stale path also asserts that the blocked apply error
leaves the remote snapshot unchanged and that blocker/reference/error evidence
is hash-only.

## Validation commands

```sh
node --check test/rpp-0363-post-author-reference-v4.test.js
node --test test/rpp-0363-post-author-reference-v4.test.js
node --test --test-name-pattern=RPP-0303 test/generated-push-harness.test.js
node --test --test-name-pattern 'post author|post_author|post-author' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0363-post-author-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result: all commands exited 0. The focused RPP-0363 test reported
2 subtests, 0 failures. The adjacent generated-harness RPP-0303 slice reported
1 subtest, 0 failures, and the adjacent planner post-author slice reported 1
subtest, 0 failures.

## Release posture

This is local regression evidence only. It does not claim production-backed
proof or alter release-verifier artifacts.
