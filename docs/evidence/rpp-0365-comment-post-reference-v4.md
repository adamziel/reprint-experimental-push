# RPP-0365 comment post reference variant 4 evidence

Date: 2026-05-30
Lane: RPP-0365 comment post reference, variant 4
Checklist item: RPP-0365 — Add focused regression coverage for comment post reference, variant 4.

## Scope

This slice adds local Node planner/apply regression coverage for the
`wp_comments.comment_post_ID` graph reference. It does not change production
code, generated harness fixtures, progress surfaces, release verifier artifacts,
auth, recovery, storage, or publish paths.

## Evidence added

- `test/rpp-0365-comment-post-reference-v4.test.js` covers a ready path where
  an explicit WordPress graph identity map rewrites a comment target from local
  post `ID:3651` to proven remote post `ID:4651`.
- The ready assertion verifies the comment mutation carries
  `wordpressGraphIdentity.rewrites` metadata for
  `wp_comments.comment_post_ID`, uses the rewritten `comment_post_ID`, carries a
  live-remote precondition, and applies locally with the remote post reference.
- The blocked assertion verifies a drifted target post blocks the comment before
  mutation. The blocker records `comment-post` relationship metadata and target
  SHA-256 hashes only, omitting raw source comment and target post values.
- The blocked apply proof checks `PLAN_NOT_READY` and confirms the remote
  snapshot digest is unchanged after refusal.

## Observed target shapes

Mapped ready comment target:

```json
{
  "sourceComment": "row:[\"wp_comments\",\"comment_ID:9365\"]",
  "relationshipKey": "wp_comments.comment_post_ID",
  "relationshipType": "comment-post",
  "sourceTarget": "row:[\"wp_posts\",\"ID:3651\"]",
  "remoteTarget": "row:[\"wp_posts\",\"ID:4651\"]",
  "plannedCommentPostId": 4651,
  "precondition": "live-remote",
  "applyTargetPostId": 4651
}
```

Drifted target evidence:

```json
{
  "sourceComment": "row:[\"wp_comments\",\"comment_ID:9366\"]",
  "relationshipKey": "wp_comments.comment_post_ID",
  "relationshipType": "comment-post",
  "target": "row:[\"wp_posts\",\"ID:3652\"]",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "update",
  "hashesOnly": true,
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY"
}
```

## Validation commands

```sh
node --check test/rpp-0365-comment-post-reference-v4.test.js
node --test test/rpp-0365-comment-post-reference-v4.test.js
nix-shell -p ripgrep --run 'rg "comment post|comment_post_ID|RPP-0305|RPP-0325|RPP-0345" test docs/reprint-push-completion-checklist.md docs/evidence'
node --test --test-name-pattern='rewrites explicit WordPress graph identity map references|blocks comment graph references' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0365-comment-post-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0365 command: 2 subtests, 0 failures.
The adjacent comment-post graph slice, checklist completion lint, touched-doc
artifact redaction scan, and whitespace diff checks were run locally after this
file and the checklist line were updated; all returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this local planner/apply slice.
