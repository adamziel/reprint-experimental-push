# RPP-0308 commentmeta comment reference evidence

Date: 2026-05-29
Lane: RPP-0308 commentmeta comment reference, variant 1
Checklist item: RPP-0308 — Implement commentmeta comment reference, variant 1.

## Scope

This slice stays inside the graph-identity planner, generated harness, focused
tests, and this evidence note for `wp_commentmeta.comment_id` references to
`wp_comments` rows. It does not touch public progress surfaces, merge-invariant
logic, plugin-driver behavior, executor-auth routes, recovery/storage,
topology, or release-ops code.

## Evidence added

- `src/planner.js` now treats `commentmeta-comment` relationship targets as
  unsupported when the referenced `wp_comments` resource cannot prove that the
  target row payload carries the same `comment_ID` as the target row key.
  Unsupported targets fail closed as `stale-wordpress-graph-identity` with
  hash-only target evidence before mutation.
- `scripts/harness/generated-push-cases.js` now exposes a dedicated
  `commentmetaCommentGraph` target bucket over the existing
  `commentmeta-comment-graph` generated tag.
- `test/rpp-0308-commentmeta-comment-reference.test.js` adds focused coverage
  for the unsupported-target guard and for generated ready/stale
  commentmeta-comment cases across all generated tiers.
- `test/generated-push-harness.test.js` aligns the RPP-0117 stale replay
  expectation with the current lane’s fail-closed unsupported `wp_usermeta`
  driver semantics: the current lane reports 344 ready stale-replay cases both
  before and after the RPP-0308 changes.

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
  },
  "staleRemoteAfterDryRun": {
    "family": "ready-plan-stale-remote-after-dry-run",
    "total": 344,
    "perTier": {
      "0": 34,
      "1": 34,
      "2": 35,
      "3": 34,
      "4": 35,
      "5": 34,
      "6": 35,
      "7": 34,
      "8": 35,
      "9": 34
    },
    "statuses": {
      "ready": 344
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
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0308-commentmeta-comment-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0308 command: 2 subtests, 0 failures.
Observed local result for the full generated harness command after lane refresh: 49
subtests, 0 failures.
Checklist completion lint returned `ok: true`. Artifact redaction scan returned
`ok: true` for this evidence file and the checklist. `git diff --check`
returned no whitespace errors.

Release remains held for broader graph-identity and production evidence gates
outside this local commentmeta-comment slice.
