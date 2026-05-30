# RPP-0194 plugin-owned option changes release verifier v5

Date: 2026-05-30

Status: focused generated-harness release-verifier proof added for variant 5.
Release remains NO-GO.

## Scenario

RPP-0194 adds `pluginOwnedOptionChangeReleaseVerifierVariant5` target coverage
for deterministic plugin-owned `wp_options` updates handled by the supported
forms `wp-option` driver. The release-verifier-v5 tag is emitted on both the
ready plugin-owned option update family and the remote-drift conflict family,
so the summary exposes per-tier counts and ready/non-ready outcomes.

## Evidence surface

- `scripts/harness/generated-push-cases.js` tags plugin-owned option updates
  with `plugin-owned-option-change-release-verifier-v5` plus ready/non-ready
  variant-5 tags and exposes
  `summary.targetCoverage.pluginOwnedOptionChangeReleaseVerifierVariant5`.
- `test/rpp-0194-plugin-owned-option-changes-release-verifier-v5.test.js`
  recounts all target cases, verifies the summary total, per-tier counts, and
  statuses, then selects one ready case and one non-ready conflict case for
  invariant checks.
- Every ready target case proves the plugin-owned option mutation carries
  forms/`wp-option` owner-driver evidence, has a matching live-remote
  precondition, applies the local option hash, preserves unplanned remote data,
  and rejects a stale remote replay with `PRECONDITION_FAILED` before the
  mutation callback.
- Every conflict target case proves the remote-drifted plugin-owned option
  suppresses the mutation/precondition, refuses apply with `PLAN_NOT_READY`
  before the mutation callback, and leaves the remote digest unchanged.
- Evidence stores resource keys, owner/driver metadata, redaction hashes,
  mutation hashes, audit hashes, conflict hashes, refusal hashes, and stale
  replay hashes. Raw plugin-owned option payloads, tokens, notes, and replay
  payloads are omitted.

Deterministic target shape observed locally:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "pluginOwnedOptionChangeReleaseVerifierVariant5": {
    "family": "plugin-owned-option-change-release-verifier-v5",
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

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0194-plugin-owned-option-changes-release-verifier-v5.test.js
node --test test/rpp-0194-plugin-owned-option-changes-release-verifier-v5.test.js
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, pluginOwnedOptionChangeReleaseVerifierVariant5: summary.targetCoverage.pluginOwnedOptionChangeReleaseVerifierVariant5 }, null, 2));"
node --test --test-name-pattern='RPP-0154|RPP-0174|RPP-0194|plugin-owned option' test/generated-push-harness.test.js test/rpp-0194-plugin-owned-option-changes-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0194-plugin-owned-option-changes-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0194 reported 2 subtests, 0 failures.

Observed adjacent generated-harness result: the
`RPP-0154|RPP-0174|RPP-0194|plugin-owned option` pattern reported 5 subtests,
0 failures.

Observed hygiene result: the scoped artifact redaction scan returned `"ok":
true` with 0 rejected files, and `git diff --check` reported no whitespace
errors.

Caveat: this is deterministic local generated-model evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
