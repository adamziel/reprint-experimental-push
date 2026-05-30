# RPP-0368 commentmeta comment reference variant 4 evidence

Date: 2026-05-30
Lane: RPP-0368 commentmeta comment reference, variant 4
Checklist item: RPP-0368 — Add focused regression coverage for commentmeta comment reference, variant 4.

## Scope

This slice adds local focused regression coverage for the existing
`wp_commentmeta.comment_id` to `wp_comments.comment_ID` graph reference. It does
not change production code, generated harness sources, progress surfaces,
release publish artifacts, auth, recovery, storage, or release-verifier files.

## Proof surface

`test/rpp-0368-commentmeta-comment-reference-v4.test.js` adds three focused
subtests:

- generated target coverage remains present for variant 4: 20 total
  `wp-comments-commentmeta-graph-v4` cases, one ready and one stale case in each
  generated tier;
- a ready generated case plans both the target comment row and the commentmeta
  row, carries the same target comment identity through planned rows and local
  apply, records live-remote preconditions, and needs no graph identity rewrite;
- a stale generated case blocks the commentmeta row before mutation, records a
  `commentmeta-comment` reference to the stale comment target, keeps the remote
  comment by decision, and refuses apply with `PLAN_NOT_READY` without changing
  the remote snapshot.

The local proof envelopes deliberately include resource keys, comment identity,
state transitions, and SHA-256 hashes only. Each path also runs a redacted row
probe and asserts that generated comment/commentmeta row fields are absent from
proof, blocker, reference, and redacted evidence surfaces.

## Observed local/generated target shape

```json
{
  "target": "wpCommentsCommentmetaGraphVariant4",
  "family": "wp-comments-commentmeta-graph-variant4",
  "total": 20,
  "perTier": {
    "0": 2,
    "1": 2,
    "2": 2,
    "3": 2,
    "4": 2,
    "5": 2,
    "6": 2,
    "7": 2,
    "8": 2,
    "9": 2
  },
  "statuses": {
    "blocked": 3,
    "conflict": 7,
    "ready": 10
  },
  "readyTags": 10,
  "staleTags": 10,
  "nonReadyTags": 10,
  "productionBacked": false
}
```

Ready proof shape:

```json
{
  "relationshipKey": "wp_commentmeta.comment_id",
  "relationshipType": "commentmeta-comment",
  "readyMutations": ["wp_comments", "wp_commentmeta"],
  "targetIdentityCarriedThroughPlan": true,
  "targetIdentityCarriedThroughApply": true,
  "preconditions": "live-remote",
  "rewriteCount": 0,
  "hashOnlyProof": true,
  "productionBacked": false
}
```

Stale proof shape:

```json
{
  "relationshipKey": "wp_commentmeta.comment_id",
  "relationshipType": "commentmeta-comment",
  "targetRemoteChange": "update",
  "plannedCommentMutation": false,
  "plannedCommentmetaMutation": false,
  "targetDecision": "keep-remote",
  "applyRefusal": "PLAN_NOT_READY",
  "remoteUnchangedAfterRefusal": true,
  "hashOnlyProof": true,
  "productionBacked": false
}
```

## Validation commands

```sh
node --check test/rpp-0368-commentmeta-comment-reference-v4.test.js
node --test test/rpp-0368-commentmeta-comment-reference-v4.test.js
nix-shell -p ripgrep --run 'rg "commentmeta|comment_id|RPP-0308|RPP-0328|RPP-0348" test'
node --test test/rpp-0308-commentmeta-comment-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0368-commentmeta-comment-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result after this evidence file and the checklist line were
updated: all commands exited 0. The focused RPP-0368 test reported 3 subtests
and 0 failures. The adjacent RPP-0308 commentmeta-comment graph slice reported
2 subtests and 0 failures. Checklist lint and the scoped artifact redaction scan
returned ok, and both diff whitespace checks passed.

## Release posture

This is local/generated model evidence only. It does not claim production-backed
proof, live release-verifier carry-through, or movement of broader release
gates.
