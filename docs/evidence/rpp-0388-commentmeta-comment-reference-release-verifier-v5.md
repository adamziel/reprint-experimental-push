# RPP-0388 commentmeta comment reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0388 commentmeta comment reference release verifier, variant 5
Checklist item: RPP-0388 — Carry through the release verifier for commentmeta comment reference, variant 5.

## Scope

This slice stays inside the focused RPP-0388 regression test, this evidence note,
and the single RPP-0388 checklist line. It does not edit generated harness files,
public progress surfaces, shared release docs, or adjacent RPP-0387/RPP-0389
files.

## Evidence added

- `test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js`
  consumes the existing generated `commentmeta-comment-graph` target coverage and
  requires 20 cases: one ready and one stale case in each generated tier 0
  through 9.
- Ready generated cases are carried through a production-shaped release verifier
  proof shape: the plan is ready, the `wp_comments` target and `wp_commentmeta`
  row are both planned, the commentmeta row carries the generated `comment_id`,
  both resources have live-remote preconditions, and apply revalidation covers the
  exact mutation resource-key set before the first mutation.
- Stale generated cases are carried as release-verifier stop evidence: non-ready
  plans produce no commentmeta mutation, the verifier proof stops before dry-run
  and apply, `stale-wordpress-graph-identity` reference evidence targets the
  drifted `wp_comments` row, and `applyPlan()` refuses before mutation.
- A source-contract assertion pins the production-shaped verifier/client boundary
  used by the local proof: planned mutation resource keys must be revalidated
  before apply, and non-ready local plans return `PLAN_NOT_READY_LOCALLY` before
  dry-run/apply.
- Evidence envelopes store resource keys, IDs, booleans, counts, and hashes only;
  the focused test checks they do not include generated comment content,
  commentmeta payloads, `comment_content`, or `meta_value` fields.

## Observed generated target shape

Hash-only target summary asserted by the focused test:

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

Ready cases report `COMMENTMETA_COMMENT_RELEASE_VERIFIER_READY_CARRIED` for all
10 tiers. Stale cases report
`COMMENTMETA_COMMENT_RELEASE_VERIFIER_STALE_STOPPED` for all 10 tiers.

## Validation commands

```sh
node --check test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js
node --test test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js
node --test test/rpp-0308-commentmeta-comment-reference.test.js test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0110/RPP-0130|RPP-0150|RPP-0170|RPP-0388' test/generated-push-harness.test.js test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0388-commentmeta-comment-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local focused result: the new RPP-0388 test covers 3 subtests with 0
failures. Release remains held for broader graph-identity and production gates
outside this local commentmeta comment reference carry-through slice.
