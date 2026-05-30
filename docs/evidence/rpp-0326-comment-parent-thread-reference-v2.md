# RPP-0326 comment parent thread reference v2 evidence

Date: 2026-05-30
Lane: RPP-0326 comment parent thread reference, variant 2
Checklist item: RPP-0326 - Prove comment parent thread reference, variant 2.

## Scope

This slice adds focused local planner/apply proof for
`wp_comments.comment_parent`. It does not edit production routes, generated
harness fixtures, release scripts, release artifacts, public progress surfaces,
or unrelated checklist lines.

## Proof surface

`test/rpp-0326-comment-parent-thread-reference-v2.test.js` builds one
deterministic hash-only proof envelope over three comment-parent paths:

- Stable parent target: a child comment whose `comment_parent` points at an
  unchanged parent comment plans one child mutation, emits one live-remote
  precondition, carries no graph rewrite, and applies with the original parent
  ID.
- Explicit identity-map target: a local parent comment mapped to an equivalent
  remote parent comment is preserved as `map-local-identity-to-remote`; the
  child comment is planned with `comment_parent` rewritten to the proven remote
  parent ID and carries `relationshipType: "comment-parent"` rewrite evidence.
- Stale parent target: a child reply whose remote parent changed after pull
  base is blocked before mutation as `stale-wordpress-graph-identity`, with
  only target resource keys, state labels, and hashes in the proof envelope.

The proof is adjacent to RPP-0306 planner coverage and RPP-0386
release-verifier carry-through coverage. It does not claim live production
release evidence.

## Evidence shape

The focused proof records this target shape without raw comment bodies:

```json
{
  "rpp": "RPP-0326",
  "evidenceSource": "focused-comment-parent-thread-reference-v2",
  "releaseGate": "NO-GO",
  "relationship": {
    "key": "wp_comments.comment_parent",
    "type": "comment-parent"
  },
  "coverage": {
    "stableParentCases": 1,
    "identityMapRewriteCases": 1,
    "staleFailClosedCases": 1,
    "adjacentPlanner": "RPP-0306",
    "adjacentReleaseVerifier": "RPP-0386"
  },
  "assertions": {
    "stableIdentityProven": true,
    "identityMapRewritten": true,
    "staleParentBlocked": true,
    "liveRemotePreconditions": true,
    "rawValuesIncluded": false
  }
}
```

## Validation commands

```sh
node --check test/rpp-0326-comment-parent-thread-reference-v2.test.js
node --test test/rpp-0326-comment-parent-thread-reference-v2.test.js
node --test --test-name-pattern 'same-plan comment|comment parent|comment_parent|comment-parent|RPP-0306' test/push-planner.test.js
node --test test/rpp-0386-comment-parent-thread-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0326-comment-parent-thread-reference-v2.md
git diff --check
```

Observed result in this lane: the focused syntax check exited 0, the focused
RPP-0326 test reported 1 subtest ok and 0 failed, the adjacent RPP-0306 planner
slice reported 4 subtests ok and 0 failed, the adjacent RPP-0386 release
verifier slice reported 4 subtests ok and 0 failed, and the scoped Markdown
artifact redaction scan returned `"ok": true`. `git diff --check` exited 0
after adding the two new files with intent-to-add so the new-file diff was
included in the whitespace check.

## Release posture

This remains local support-only graph-identity evidence. Final release posture
stays `NO-GO` until the separate checked production release proof and broader
release gates are satisfied.
