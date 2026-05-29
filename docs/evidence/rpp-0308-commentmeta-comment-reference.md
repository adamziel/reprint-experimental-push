# RPP-0308 commentmeta comment reference evidence

Date: 2026-05-29
Lane: RPP-0308 commentmeta comment reference, variant 1
Checklist item: RPP-0308 — Implement commentmeta comment reference, variant 1.

## Scope

This slice stays inside the graph-identity planner, generated harness, focused
tests, and this evidence note for `wp_commentmeta.comment_id` references to
`wp_comments` rows. It does not touch public progress surfaces, unrelated
generated-harness targets, merge-invariants, plugin-driver paths, executor-auth
routes, recovery/storage, topology, or release-ops code.

## Evidence added

- `src/planner.js` now treats `commentmeta-comment` relationship targets as
  unsupported when the referenced `wp_comments` row cannot prove a matching
  `comment_ID` for the target row key. Unsupported targets stop as
  `stale-wordpress-graph-identity` with hash-only target evidence before
  mutation.
- `scripts/harness/generated-push-cases.js` now exposes a dedicated
  `commentmetaCommentGraph` target coverage bucket over the existing
  `commentmeta-comment-graph` generated tag.
- `test/rpp-0308-commentmeta-comment-reference.test.js` adds focused coverage
  for the unsupported-target planner guard and for generated ready/stale
  commentmeta comment cases across all generated harness tiers.

## Observed generated target shape

Hash-only summary from the focused generated harness assertion:

```json
{
  "commentmetaCommentGraph": {
    "family": "wp-comments-commentmeta-graph-ready",
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
    }
  }
}
```

Ready generated cases create the `wp_comments` target and the
`wp_commentmeta` row in one plan, apply the commentmeta row with the generated
`comment_id`, preserve unrelated remote resources, and reject stale replay
before mutation. Stale generated cases are non-ready, block the commentmeta
row, emit `wp_commentmeta.comment_id` reference evidence to the drifted
`wp_comments` target, and keep generated comment/commentmeta values out of
serialized blocker evidence.

## Validation commands

```sh
node --test test/rpp-0308-commentmeta-comment-reference.test.js
node --test --test-name-pattern 'RPP-0308|commentmeta comment|commentmeta-comment' test/rpp-0308-commentmeta-comment-reference.test.js test/push-planner.test.js test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0308-commentmeta-comment-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0308 command: 2 subtests, 0 failures.
Observed local result for the broader focused graph/generated-harness command:
4 subtests, 0 failures.

The full generated-harness command is recorded in the worker report: it returned
46 subtests with 0 failures in RPP-0308/commentmeta coverage and one existing
RPP-0117 stale-replay count mismatch outside this slice.

Release remains held for broader graph-identity and production evidence gates
outside this local commentmeta-comment slice.
