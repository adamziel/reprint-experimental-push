# RPP-0327 comment user reference v2 evidence

Date: 2026-05-30
Lane: RPP-0327 comment user reference, variant 2
Checklist item: RPP-0327 - Prove comment user reference, variant 2.

## Scope

This is a focused local planner/apply proof for the `wp_comments.user_id`
graph identity surface. It reuses the comment-user behavior covered by
RPP-0307 and the fail-closed release-verifier posture carried by RPP-0387,
without changing generated harness fixtures, release scripts, progress
artifacts, production routes, or adjacent graph lanes.

## Proof surface

`test/rpp-0327-comment-user-reference-v2.test.js` builds a comment create whose
`user_id` points at a `wp_users` row key that cannot prove the same WordPress
numeric user ID. The proof requires:

- the plan to stay `blocked` with one `stale-wordpress-graph-identity` blocker;
- the unsupported `comment-user` reference to record `wp_comments.user_id`,
  the target resource key, unchanged target states, and source/target hashes;
- no comment mutation, no precondition, and no decision for the unsupported
  target row;
- both the blocked plan and a forged-ready replay to fail before mutation while
  leaving the remote hash unchanged; and
- serialized proof evidence to remain hash-only, excluding raw comment text and
  user-row payload fields.

The summarized proof shape is:

```json
{
  "rpp": "RPP-0327",
  "evidenceSource": "comment-user-reference-v2",
  "status": "support_only",
  "verdict": "COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY",
  "releaseGate": "NO-GO",
  "unsupportedTarget": {
    "relationshipKey": "wp_comments.user_id",
    "relationshipType": "comment-user",
    "targetResourceKey": "row:[\"wp_users\",\"ID:327\"]",
    "targetSupport": {
      "supported": false,
      "className": "stale-wordpress-graph-identity"
    },
    "hashes": {
      "sourceBaseHash": "<sha256>",
      "sourceLocalHash": "<sha256>",
      "sourceRemoteHash": "<sha256>",
      "targetBaseHash": "<sha256>",
      "targetLocalHash": "<sha256>",
      "targetRemoteHash": "<sha256>"
    }
  },
  "failClosed": {
    "blockedApply": "PLAN_NOT_READY",
    "forgedReadyApply": "PLAN_INVARIANT_VIOLATION"
  }
}
```

The deterministic subtest rebuilds the proof twice and requires identical
hash-only evidence.

## Validation

Focused validation commands:

```sh
node --check test/rpp-0327-comment-user-reference-v2.test.js
node --test test/rpp-0327-comment-user-reference-v2.test.js
node --test test/rpp-0307-comment-user-reference.test.js
node --test test/rpp-0387-comment-user-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0327-comment-user-reference-v2.md
git diff --check
```

## Release posture

This lane is local support-only evidence. It proves that an unsupported
`wp_comments.user_id` target fails closed with hash-only evidence, but it is
not live production proof. Final release posture remains `NO-GO` until the
broader production verifier boundary is satisfied.
