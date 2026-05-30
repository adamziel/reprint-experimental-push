# RPP-0190 wp_comments and wp_commentmeta graph release verifier v5

Status: focused generated-harness release-verifier proof added for variant 5.
Release remains NO-GO.

## Scenario

RPP-0190 adds an explicit
`wpCommentsCommentmetaGraphReleaseVerifierVariant5` target coverage surface for
deterministic `wp_comments` and `wp_commentmeta` graph changes. The
release-verifier-v5 tag is emitted on both the ready comment/commentmeta graph
family and the stale graph-reference family so the summary exposes per-tier
counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags `wp_comments` and
  `wp_commentmeta` graph cases with
  `wp-comments-commentmeta-graph-release-verifier-v5` plus ready/stale/non-ready
  variant-5 tags and exposes
  `summary.targetCoverage.wpCommentsCommentmetaGraphReleaseVerifierVariant5`.
- `test/rpp-0190-wp-comments-commentmeta-graph-release-verifier-v5.test.js`
  recounts all target cases, checks the summary total, per-tier counts, and
  statuses, then selects one ready case and one stale non-ready case for
  invariant checks.
- Every ready target case proves the generated `wp_comments` and
  `wp_commentmeta` row creates carry matching live-remote preconditions, apply
  the local hashes, preserve unplanned remote data, and reject stale replay
  against both rows with `PRECONDITION_FAILED` before the mutation callback.
- Every stale target case proves the graph identity blocker prevents the
  commentmeta row from referencing a drifted remote comment, emits no planned
  mutation/precondition for the graph rows, refuses apply with `PLAN_NOT_READY`
  before the mutation callback, and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, comment-id hashes,
  meta-key hashes, counts, blocker hashes, decision hashes, refusal hashes, and
  precondition/mutation hashes. It omits raw comment content, commentmeta keys,
  commentmeta values, and stale replay payloads.

Deterministic target shape observed locally:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "wpCommentsCommentmetaGraphReleaseVerifierVariant5": {
    "family": "wp-comments-commentmeta-graph-release-verifier-v5",
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

## Validation commands

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0190-wp-comments-commentmeta-graph-release-verifier-v5.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test test/rpp-0190-wp-comments-commentmeta-graph-release-verifier-v5.test.js
```

Observed focused result: 2 subtests, 0 failures.

Generated summary command:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, wpCommentsCommentmetaGraphReleaseVerifierVariant5: summary.targetCoverage.wpCommentsCommentmetaGraphReleaseVerifierVariant5 }, null, 2));"
```

Observed summary result: the JSON shape above.

Adjacent generated-harness command:

```sh
node --test --test-name-pattern='RPP-0150|RPP-0170|RPP-0190' test/generated-push-harness.test.js test/rpp-0190-wp-comments-commentmeta-graph-release-verifier-v5.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0190-wp-comments-commentmeta-graph-release-verifier-v5.md
git diff --check
```

Observed hygiene result: the scoped redaction scan returned `"ok": true` with
0 rejected files, and the diff whitespace check reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
