# RPP-0378 GUID and slug collision handling variant 4

Date: 2026-05-30
Lane: RPP-0378 GUID and slug collision handling, variant 4
Checklist item: RPP-0378 - Add focused regression coverage for GUID and slug
collision handling, variant 4.

## Scope

This is a local focused graph-identity regression slice. It does not modify the
shared generated harness implementation, release gates, progress surfaces, or
RPP-0377 files. Release remains gated by the broader integration and production
lanes.

## Proof surface

- `test/rpp-0378-guid-slug-collision-handling-v4.test.js` adds a deterministic
  four-case local harness tagged for RPP-0378.
- The harness includes one ready case with an explicit WordPress graph identity
  map from local post `ID:2001` to remote post `ID:3001`. The posts carry the
  same GUID and `post_type + post_name`; the planner keeps the remote row,
  maps the local identity to it, and rewrites a child page `post_parent` from
  `2001` to `3001` before apply.
- The harness includes three stale/non-ready collision cases: GUID-only,
  slug-only, and combined GUID plus slug. Each emits a
  `stale-wordpress-graph-identity` blocker with `wp_posts.identity` /
  `post-natural-identity-collision` evidence and no mutation for the colliding
  local post.
- Blocked cases refuse apply with `PLAN_NOT_READY` before mutation callbacks and
  leave the remote digest unchanged.
- The ready mapped case applies exactly one child-row mutation, preserves the
  mapped remote post row, and rejects a stale child-row replay with
  `PRECONDITION_FAILED` while leaving the remote digest unchanged.
- Evidence asserted by the test is hash-only: resource keys, identity-kind
  labels, state counts, hashes, refusal codes, and proof hashes. Raw local and
  remote titles, GUIDs, and slugs are checked as absent from aggregate evidence.

Observed local target shape:

```json
{
  "generatedHarness": {
    "totalCases": 4,
    "readyCases": 1,
    "staleCases": 3,
    "variants": [
      "ready-explicit-identity-map",
      "stale-guid-collision",
      "stale-slug-collision",
      "stale-guid-slug-collision"
    ]
  },
  "statuses": {
    "blocked": 3,
    "ready": 1
  },
  "outcomes": {
    "collision-blocked": 3,
    "mapped-ready": 1
  }
}
```

## Validation commands

```sh
node --check test/rpp-0378-guid-slug-collision-handling-v4.test.js
node --test test/rpp-0378-guid-slug-collision-handling-v4.test.js
node --test --test-name-pattern='post GUID and slug collisions|explicit WordPress graph identity map' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0378-guid-slug-collision-handling-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused results: the syntax check exited 0; the new RPP-0378 test
reported 1 subtest and 0 failures; the adjacent graph-identity planner command
reported 4 subtests and 0 failures. Checklist lint and artifact redaction scan
both exited 0. Whitespace checks reported no issues.

Caveat: this is local deterministic graph-identity evidence. It does not replace
release-gate, integration-lane, or production-backed validation.
