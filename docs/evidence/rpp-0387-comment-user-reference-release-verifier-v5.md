# RPP-0387 comment user reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0387 comment user reference release-verifier carry-through, variant 5
Checklist item: RPP-0387 — Carry through the release verifier for comment user reference, variant 5.

## Scope

This is a focused local release-verifier regression for the
`wp_comments.user_id` graph identity surface. It exercises the existing planner
and apply/replay guard with an unsupported `wp_users` target and records only a
support-only `NO-GO` proof. It does not alter generated harness fixtures,
release scripts, progress surfaces, or adjacent RPP-0386/RPP-0388 lanes.

## Proof surface

`test/rpp-0387-comment-user-reference-release-verifier-v5.test.js` proves that
the release verifier:

- builds a blocked plan for a `wp_comments` create whose `user_id` points at a
  `wp_users` row that cannot prove the referenced numeric ID;
- carries the `stale-wordpress-graph-identity` blocker, `comment-user`
  relationship metadata, target support refusal, and source/target hashes into
  a local release-verifier proof envelope;
- leaves the release gate `NO-GO`, `support_only`, and not release eligible;
- rejects both the blocked plan and a forged-ready replay before mutation; and
- keeps evidence hash-only, excluding raw comment text and user row fields from
  serialized proof data.

The summarized proof shape is:

```json
{
  "rpp": "RPP-0387",
  "evidenceSource": "release-verifier-comment-user-reference-v5",
  "status": "support_only",
  "verdict": "COMMENT_USER_UNSUPPORTED_TARGET_FAILS_CLOSED_HASH_ONLY",
  "releaseGate": "NO-GO",
  "unsupportedTarget": {
    "relationshipKey": "wp_comments.user_id",
    "relationshipType": "comment-user",
    "targetResourceKey": "row:[\"wp_users\",\"ID:77\"]",
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

The deterministic replay subtest rebuilds the fixture and proof twice, then
requires byte-for-byte equivalent hash-only evidence.

## Focused verification observed locally

```sh
node --check test/rpp-0387-comment-user-reference-release-verifier-v5.test.js
node --test test/rpp-0387-comment-user-reference-release-verifier-v5.test.js
node --test test/rpp-0307-comment-user-reference.test.js
node --test --test-name-pattern 'comment user|RPP-0347' test/push-planner.test.js test/generated-push-harness.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0282-independent-local-row-remote-file-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0387-comment-user-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0387
test reported 2 subtests ok and 0 failed. The adjacent RPP-0307 comment user
slice reported 2 subtests ok and 0 failed. The focused comment-user planner and
generated-harness subset reported 2 subtests ok and 0 failed. The adjacent
release-verifier/hash-only support suite reported 4 subtests ok and 0 failed.
Checklist lint returned `"ok": true`; the scoped artifact redaction scan
returned `"ok": true` for the touched docs.

## Release posture

This lane is local support-only release-verifier evidence. It proves that an
unsupported `wp_comments.user_id` target fails closed with hash-only evidence,
but it is not checked live production proof. The release gate remains `NO-GO`
until the broader production verifier boundary is satisfied.
