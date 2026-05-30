# RPP-0328 commentmeta comment reference v2 evidence

Date: 2026-05-30
Lane: RPP-0328 commentmeta comment reference, variant 2
Checklist item: RPP-0328 - Prove commentmeta comment reference, variant 2.
Success condition: generated harness includes ready and stale cases.

## Scope

This slice adds a focused generated-harness proof for the existing
`wp_commentmeta.comment_id` to `wp_comments.comment_ID` graph reference. It only
adds the RPP-0328 test and this evidence note. It does not change production
code, generated harness source, planner/apply behavior, release verifier code,
checklist state, progress surfaces, or adjacent RPP-0308/RPP-0388 files.

## Proof surface

`test/rpp-0328-commentmeta-comment-reference-v2.test.js` consumes the existing
generated `commentmeta-comment-graph` target coverage and proves:

- the generated harness exposes 20 commentmeta-comment cases, one ready and one
  stale/non-ready case in each generated tier 0 through 9;
- ready cases plan the target `wp_comments` row and source `wp_commentmeta` row
  together, carry the same numeric `comment_ID`/`comment_id` identity, keep graph
  rewrite counts at zero, apply both rows, preserve unrelated remote state, and
  reject stale replay before mutation; and
- stale cases are non-ready, plan no comment or commentmeta mutation, carry
  `stale-wordpress-graph-identity` reference evidence from
  `wp_commentmeta.comment_id` to the drifted `wp_comments` target, and refuse
  apply with `PLAN_NOT_READY` before the first mutation.

## Observed generated target shape

The focused test asserts this generated-harness summary:

```json
{
  "target": "commentmetaCommentGraph",
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
  },
  "readyCases": 10,
  "staleCases": 10
}
```

Ready proof verdicts are
`COMMENTMETA_COMMENT_GENERATED_READY_CARRIED_V2` for all 10 tiers. Stale proof
verdicts are `COMMENTMETA_COMMENT_GENERATED_STALE_STOPPED_V2` for all 10 tiers.

## Hash-only evidence

The RPP-0328 proof envelopes are local generated-model evidence. They include
resource keys, numeric comment identities, planner/apply statuses, live
precondition flags, mutation/refusal counts, and SHA-256 hashes. The test scans
proof, blocker, and reference envelopes to ensure generated comment content,
commentmeta payloads, and raw row field names such as `comment_content` and
`meta_value` are absent.

The stale path also asserts blocker/reference change evidence is hash-only:
`base`, `local`, and `remote` states expose hashes and do not expose raw row
values.

## Validation commands

```sh
node --check test/rpp-0328-commentmeta-comment-reference-v2.test.js
node --test test/rpp-0328-commentmeta-comment-reference-v2.test.js
node --test test/rpp-0308-commentmeta-comment-reference.test.js test/rpp-0388-commentmeta-comment-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0328-commentmeta-comment-reference-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0328 test reported 3 subtests, 0 failures; the adjacent RPP-0308/RPP-0388
run reported 5 subtests, 0 failures; artifact redaction scan for this evidence
file returned `ok:true`; and whitespace diff check passed.

## Release posture

This is local generated-harness proof only. It does not claim live external
production evidence or final release readiness. The integration recommendation is
to keep this as a support proof alongside RPP-0308 and RPP-0388, with broader
release movement still gated on the production-backed release evidence lanes.
