# RPP-0306 comment parent thread reference evidence

Date: 2026-05-29
Lane: RPP-0306 comment parent thread reference, variant 1
Checklist item: RPP-0306 — Implement comment parent thread reference, variant 1.

## Scope

This slice stays inside graph-identity planner coverage for
`wp_comments.comment_parent` references. It does not touch generated-harness,
merge-invariant, plugin-driver, executor-auth, recovery, storage-performance,
topology, release-ops, or public progress surfaces.

## Evidence added

- `test/push-planner.test.js` adds a focused RPP-0306 regression proving that a
  child comment can be planned when its `comment_parent` points at a stable
  parent comment that still matches the pull base on the remote.
- Existing planner coverage already proves the complementary rewrite path:
  explicit WordPress graph identity-map metadata rewrites a child comment's
  `comment_parent` from the mapped local parent comment ID to the proven remote
  parent comment ID.
- Existing stale-target coverage blocks a child reply before mutation when the
  remote parent comment diverged after the pull base and records only resource
  keys, target state, and hashes for the parent reference.

## Observed target shape

The focused stable-target case plans exactly one mutation:

```json
{
  "resourceKey": "row:[\"wp_comments\",\"comment_ID:32\"]",
  "relationship": "wp_comments.comment_parent",
  "targetResourceKey": "row:[\"wp_comments\",\"comment_ID:31\"]",
  "targetRemoteState": "stable",
  "plannedCommentParent": 31,
  "wordpressGraphIdentityRewrite": false,
  "liveRemotePrecondition": true
}
```

The identity-map rewrite case plans the child comment with
`comment_parent` rewritten to the proven remote parent comment ID and records
`relationshipType: "comment-parent"` rewrite evidence.

## Validation commands

```sh
node --test --test-name-pattern=RPP-0306 test/push-planner.test.js
node --test --test-name-pattern 'same-plan comment|comment parent|comment_parent|comment-parent|RPP-0306' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0306-comment-parent-reference.md docs/evidence/ao-graph-identity.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0306 command: 1 subtest, 0 failures.
Observed local result for the broader focused comment-parent command: 4 subtests,
0 failures.

Release remains held for the broader graph-identity and production evidence
gates outside this local planner slice.
