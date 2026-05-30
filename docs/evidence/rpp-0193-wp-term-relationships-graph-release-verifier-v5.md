# RPP-0193 wp_term_relationships graph release verifier v5

Status: focused generated-harness release-verifier proof added for variant 5.
Release remains NO-GO.

## Scenario

RPP-0193 adds an explicit
`wpTermRelationshipsGraphReleaseVerifierVariant5` target coverage surface for
deterministic `wp_terms`, `wp_term_taxonomy`, and `wp_term_relationships`
graph changes. The release-verifier-v5 tag is emitted on both the ready
relationship graph family and the stale taxonomy-reference family so the
summary exposes per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags relationship graph cases
  with `wp-term-relationships-graph-release-verifier-v5` plus ready, stale,
  and non-ready variant-5 tags and exposes
  `summary.targetCoverage.wpTermRelationshipsGraphReleaseVerifierVariant5`.
- `test/rpp-0193-wp-term-relationships-graph-release-verifier-v5.test.js`
  recounts all target cases, checks the summary total, per-tier counts, and
  statuses, then selects one ready case and one stale non-ready case for
  invariant checks.
- Every ready target case proves the generated `wp_terms`,
  `wp_term_taxonomy`, and `wp_term_relationships` row creates carry matching
  live-remote preconditions, apply the local hashes, preserve unplanned remote
  data, and reject stale replay against all three graph rows with
  `PRECONDITION_FAILED` before the mutation callback.
- Every stale target case proves the graph identity blocker prevents the
  relationship row from referencing a drifted remote taxonomy row, emits no
  planned mutation/precondition for the graph rows, refuses apply with
  `PLAN_NOT_READY` before the mutation callback, and leaves the remote digest
  unchanged.
- The generated model evidence stores only resource keys, term-id hashes,
  term-slug hashes, taxonomy hashes, description hashes, relationship field
  hashes, blocker hashes, decision hashes, refusal hashes, precondition hashes,
  mutation hashes, and remote-only preservation hashes. It omits raw term
  names, slugs, taxonomy descriptions, stale taxonomy drift values, replay
  payloads, and remote-only file contents.

Deterministic target shape observed locally:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "wpTermRelationshipsGraphReleaseVerifierVariant5": {
    "family": "wp-term-relationships-graph-release-verifier-v5",
    "total": 10,
    "perTier": {
      "0": 1,
      "1": 1,
      "2": 1,
      "3": 1,
      "4": 1,
      "5": 1,
      "6": 1,
      "7": 1,
      "8": 1,
      "9": 1
    },
    "statuses": {
      "blocked": 5,
      "ready": 5
    }
  }
}
```

## Validation commands

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0193-wp-term-relationships-graph-release-verifier-v5.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test test/rpp-0193-wp-term-relationships-graph-release-verifier-v5.test.js
```

Observed focused result: 2 subtests, 0 failures.

Generated summary command:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, wpTermRelationshipsGraphReleaseVerifierVariant5: summary.targetCoverage.wpTermRelationshipsGraphReleaseVerifierVariant5 }, null, 2));"
```

Observed summary result: the JSON shape above.

Adjacent generated-harness command:

```sh
node --test --test-name-pattern='RPP-0153|RPP-0173|RPP-0193' test/generated-push-harness.test.js test/rpp-0193-wp-term-relationships-graph-release-verifier-v5.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0193-wp-term-relationships-graph-release-verifier-v5.md
git diff --check
```

Observed hygiene result: the scoped redaction scan returned `"ok": true` with
0 rejected files, and the diff whitespace check reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
