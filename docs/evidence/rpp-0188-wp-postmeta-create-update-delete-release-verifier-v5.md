# RPP-0188 wp_postmeta create/update/delete release verifier v5

Status: focused generated-harness release-verifier proof added for variant 5.
Release remains NO-GO.

## Scenario

RPP-0188 adds an explicit
`wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5` target coverage surface
for deterministic `wp_postmeta` create/update/delete changes. The
release-verifier-v5 tag is emitted on both the ready postmeta
create/update/delete family and the conflicting remote-drift family so the
summary exposes per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags `wp_postmeta`
  create/update/delete cases with
  `wp-postmeta-create-update-delete-release-verifier-v5` plus ready/non-ready
  variant-5 tags and exposes
  `summary.targetCoverage.wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5`.
- `test/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.test.js`
  recounts all target cases, checks the summary total, per-tier counts, and
  statuses, then selects one ready case and one non-ready conflict case for
  invariant checks.
- Every ready target case proves generated postmeta create, update, and delete
  mutations each carry matching live-remote preconditions, apply the local
  `wp_postmeta` hash, preserve unplanned remote data, and reject stale replay
  with `PRECONDITION_FAILED` before the mutation callback.
- Every non-ready target case proves remote drift on the updated
  `wp_postmeta` row remains a `row-conflict`, has no planned mutation or
  precondition for the conflicted update, refuses apply with `PLAN_NOT_READY`
  before the mutation callback, and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, parent post IDs,
  meta-key hashes, counts, hashes, conflict hashes, and refusal hashes. It
  omits raw postmeta values.

Deterministic target shape observed locally:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5": {
    "family": "wp-postmeta-create-update-delete-release-verifier-v5",
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
      "conflict": 10,
      "ready": 10
    }
  }
}
```

## Validation commands

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test test/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.test.js
```

Observed focused result: 2 subtests, 0 failures.

Generated summary command:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5: summary.targetCoverage.wpPostmetaCreateUpdateDeleteReleaseVerifierVariant5 }, null, 2));"
```

Observed summary result: the JSON shape above.

Adjacent generated-harness command:

```sh
node --test --test-name-pattern='RPP-0148|RPP-0168|RPP-0188' test/generated-push-harness.test.js test/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0188-wp-postmeta-create-update-delete-release-verifier-v5.md docs/generated-push-harness.md
git diff --check
```

Observed hygiene result: the scoped redaction scan returned `"ok": true` with
0 rejected files, and the diff whitespace check reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
