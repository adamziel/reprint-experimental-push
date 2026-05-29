# RPP-0307 comment user reference evidence

Date: 2026-05-29
Lane: RPP-0307 comment user reference, variant 1
Checklist item: RPP-0307 — Implement comment user reference, variant 1.

## Scope

This slice stays inside graph-identity planner coverage for
`wp_comments.user_id` references. It does not touch generated-harness,
merge-invariants, plugin-driver, executor-auth routes, recovery/storage,
topology, release-ops, `progress.html`, or unrelated checklist lines.

## Evidence added

- `src/planner.js` now treats a `comment-user` graph target as unsupported when
  the referenced `wp_users` row cannot prove a matching WordPress `ID` for the
  row key. Unsupported targets stop as `stale-wordpress-graph-identity` before
  mutation.
- `test/rpp-0307-comment-user-reference.test.js` adds focused planner coverage
  for the supported stable-target path and the unsupported-target path.
- The unsupported-target assertion verifies that blocker and target evidence is
  hash-only: source comment values and private user fields are absent from the
  serialized blocker while base/local/remote hashes remain present.

## Observed target shape

The unsupported-target case records only relationship metadata and hashes for
`wp_comments.user_id`:

```json
{
  "resourceKey": "row:[\"wp_comments\",\"comment_ID:308\"]",
  "relationshipKey": "wp_comments.user_id",
  "relationshipType": "comment-user",
  "targetResourceKey": "row:[\"wp_users\",\"ID:7\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "unchanged",
  "targetBaseHash": "<sha256>",
  "targetLocalHash": "<sha256>",
  "targetRemoteHash": "<sha256>"
}
```

The supported stable-target case plans one `wp_comments` create with
`user_id: 7`, no identity rewrite, and a live-remote precondition.

## Validation commands

```sh
node --test test/rpp-0307-comment-user-reference.test.js
node --test --test-name-pattern='comment user' test/push-planner.test.js test/generated-push-harness.test.js
node --test --test-name-pattern='graph' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0307-comment-user-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0307 command: 2 subtests, 0 failures.
Observed local result for the existing broader comment-user command: 2 subtests,
0 failures. Observed local result for the focused push-planner graph command:
15 subtests, 0 failures. Checklist lint and touched-doc redaction scan returned
`ok: true`; `git diff --check` returned no whitespace errors.

Release remains held for broader graph-identity and production evidence gates
outside this local planner slice.
