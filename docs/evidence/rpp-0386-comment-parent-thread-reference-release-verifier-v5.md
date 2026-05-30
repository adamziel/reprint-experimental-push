# RPP-0386 comment parent thread reference release verifier v5 evidence

Date: 2026-05-30

## Scope

This is a focused local release-verifier carry-through slice for
`wp_comments.comment_parent` thread references, variant 5. It does not claim a
live production release run; the evidence remains local/support-only and keeps
the release gate at `NO-GO`.

## Proof surface

`test/rpp-0386-comment-parent-thread-reference-release-verifier-v5.test.js`
adds release-verifier-shaped coverage that proves:

- a child comment whose `comment_parent` points at a stable parent comment is
  carried through `releaseProof.planObject.mutations[]` with no graph rewrite,
  one live-remote precondition, and apply revalidation before the first
  mutation;
- an explicit `wordpressGraphIdentityMap` rewrites a child reply from the local
  parent comment id to the proven remote parent comment id, preserving
  `relationshipType: "comment-parent"` evidence through the release verifier
  summary;
- the evidence fails closed if the carried `comment_parent` no longer equals
  the expected stable or rewritten target; and
- the production-shaped release verifier still emits the generic plan and
  apply-revalidation surfaces (`releaseProof: proof`,
  `releaseProof.planObject`, and
  `releaseProof.apply.applyRevalidation.verifiedResourceKeys`) used by this
  focused proof.

The serialized evidence summary contains only resource keys, relationship
labels, row ids, hashes, precondition/apply-revalidation facts, and release-gate
metadata. Raw comment bodies are checked out of the summary with
`assertEvidenceHasNoRawValues`.

## Focused verification observed locally

```sh
node --check test/rpp-0386-comment-parent-thread-reference-release-verifier-v5.test.js
node --test test/rpp-0386-comment-parent-thread-reference-release-verifier-v5.test.js
node --test --test-name-pattern 'same-plan comment|comment parent|comment_parent|comment-parent|RPP-0306' test/push-planner.test.js
node --test --test-name-pattern 'comment graph|comment parent and commentmeta' test/local-production-complex-site-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0386-comment-parent-thread-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this worktree. The focused RPP-0386
test reported 4 subtests ok and 0 failed. The adjacent planner run reported 4
comment-parent subtests ok and 0 failed. The local-production comment graph run
reported 2 subtests ok and 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This lane proves local release-verifier carry-through for the assigned
`wp_comments.comment_parent` target. It remains support-only evidence; final
release posture is still `NO-GO` without the broader checked production release
proof.
