# RPP-0367 comment user reference v4 evidence

Date: 2026-05-30
Lane: RPP-0367 comment user reference, variant 4
Checklist item: RPP-0367 — Add focused regression coverage for comment user
reference, variant 4.

## Scope

This slice adds local planner regression coverage for `wp_comments.user_id`
references only. It does not change production planner code, generated harness
files, auth, recovery, storage, release-verifier artifacts, release publish
artifacts, progress surfaces, or unrelated checklist rows. The proof is local
test evidence, not production-backed proof.

## Evidence added

- `test/rpp-0367-comment-user-reference-v4.test.js` adds two focused
  fail-closed cases for comment user graph references.
- The stale-target case creates a local comment that points at an otherwise
  supported `wp_users` row after the remote user row drifted from the pull base.
  The planner blocks the comment mutation as
  `stale-wordpress-graph-identity`, records `wp_comments.user_id` reference
  evidence, keeps the remote user, emits no comment mutation, and refuses
  apply before mutating the remote snapshot.
- The unsupported-target case creates a local comment that points at a
  `wp_users` row whose row key and payload ID do not match. The planner blocks
  the comment mutation, records `targetSupport.supported: false`, emits no
  mutation for the comment, and refuses apply before mutating the remote
  snapshot.
- Both cases assert that serialized plan evidence omits the raw local comment
  body and raw user payload fields while retaining SHA-256 hashes for the
  source blocker and target reference state.

## Observed target shapes

Stale user target:

```json
{
  "resourceKey": "row:[\"wp_comments\",\"comment_ID:3671\"]",
  "relationshipKey": "wp_comments.user_id",
  "relationshipType": "comment-user",
  "targetResourceKey": "row:[\"wp_users\",\"ID:367\"]",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "update",
  "targetBaseHash": "<sha256>",
  "targetLocalHash": "<sha256>",
  "targetRemoteHash": "<sha256>",
  "plannedMutation": false
}
```

Unsupported user target:

```json
{
  "resourceKey": "row:[\"wp_comments\",\"comment_ID:3672\"]",
  "relationshipKey": "wp_comments.user_id",
  "relationshipType": "comment-user",
  "targetResourceKey": "row:[\"wp_users\",\"ID:9367\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "unchanged",
  "targetBaseHash": "<sha256>",
  "targetLocalHash": "<sha256>",
  "targetRemoteHash": "<sha256>",
  "plannedMutation": false
}
```

## Validation commands

```sh
node --check test/rpp-0367-comment-user-reference-v4.test.js
node --test test/rpp-0367-comment-user-reference-v4.test.js
nix-shell -p ripgrep --run 'rg "comment user|user_id|RPP-0307|RPP-0327|RPP-0347" test'
node --test --test-name-pattern='comment user|RPP-0307|RPP-0347' test/rpp-0307-comment-user-reference.test.js test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0367-comment-user-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Focused RPP-0367 validation observed 2 subtests, 0 failures. The adjacent
comment-user graph slice discovered by ripgrep covered RPP-0307, the existing
push-planner stale comment-user blocker, and RPP-0347 generated harness
coverage with 4 subtests, 0 failures. Checklist lint returned `ok: true`;
touched-artifact redaction scan returned `ok: true`; diff whitespace checks
returned no findings.

Release remains held for broader graph-identity and production evidence gates
outside this local planner regression slice.
