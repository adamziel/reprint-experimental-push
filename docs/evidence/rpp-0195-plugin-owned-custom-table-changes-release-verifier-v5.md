# RPP-0195 plugin-owned custom-table changes release verifier v5

Date: 2026-05-30

Status: focused generated-harness release-verifier proof added for variant 5.
Release remains NO-GO.

## Scenario

RPP-0195 adds `pluginOwnedCustomTableChangesReleaseVerifierVariant5` target
coverage for deterministic plugin-owned forms-lab custom-table row updates
handled by the supported forms `fixture-forms-lab-table` driver. The
release-verifier-v5 tag is emitted on both ready custom-table updates and
stale remote-drift conflict cases, so the summary exposes per-tier counts and
ready/non-ready outcomes for the plugin-owned custom-table surface.

## Evidence surface

- `scripts/harness/generated-push-cases.js` tags forms-lab custom-table update
  cases with `plugin-owned-custom-table-changes-release-verifier-v5` plus
  ready, stale, and non-ready variant-5 tags, and exposes
  `summary.targetCoverage.pluginOwnedCustomTableChangesReleaseVerifierVariant5`.
- `test/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.test.js`
  recounts all target cases, verifies summary total, per-tier counts, and
  statuses, then selects one ready case and one stale non-ready conflict case
  for invariant checks.
- Every ready target case proves the `fixture-forms-lab-table` mutation carries
  forms owner-driver evidence, delete support remains false, the mutation has a
  matching live-remote precondition, the local custom-table row hash is applied,
  the unplanned remote-only file is preserved, and stale replay fails with
  `PRECONDITION_FAILED` before the mutation callback.
- Every stale target case proves the remote-drifted custom-table row suppresses
  mutation/precondition planning, refuses apply with `PLAN_NOT_READY` before the
  mutation callback, and leaves the remote digest unchanged.
- Evidence stores resource keys, owner/driver metadata, redaction hashes,
  mutation hashes, audit hashes, conflict hashes, refusal hashes, row/field
  hashes, and stale replay hashes. Raw custom-table payload values, row slugs,
  remote-only file contents, and replay payloads are omitted.

Deterministic target shape observed locally:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "pluginOwnedCustomTableChangesReleaseVerifierVariant5": {
    "family": "plugin-owned-custom-table-changes-release-verifier-v5",
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
      "conflict": 5,
      "ready": 5
    }
  },
  "featureFamilies": {
    "tag": 10,
    "ready": 5,
    "stale": 5,
    "nonReady": 5
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.test.js
node --test test/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.test.js
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, pluginOwnedCustomTableChangesReleaseVerifierVariant5: summary.targetCoverage.pluginOwnedCustomTableChangesReleaseVerifierVariant5, featureFamilies: { tag: summary.featureFamilies['plugin-owned-custom-table-changes-release-verifier-v5'], ready: summary.featureFamilies['plugin-owned-custom-table-changes-release-verifier-v5-ready'], stale: summary.featureFamilies['plugin-owned-custom-table-changes-release-verifier-v5-stale'], nonReady: summary.featureFamilies['plugin-owned-custom-table-changes-release-verifier-v5-non-ready'] } }, null, 2));"
node --test --test-name-pattern='RPP-0155|RPP-0175|RPP-0195|plugin-owned custom' test/generated-push-harness.test.js test/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0195-plugin-owned-custom-table-changes-release-verifier-v5.md
git diff --check
```

Observed syntax result: both `node --check` commands exited 0.

Observed focused result: RPP-0195 reported 2 subtests, 0 failures.

Observed adjacent generated-harness result: the
`RPP-0155|RPP-0175|RPP-0195|plugin-owned custom` pattern reported 6 subtests,
0 failures.

Observed hygiene result: the scoped artifact redaction scan returned `"ok":
true` with 0 rejected files, and `git diff --check` reported no whitespace
errors.

Caveat: this is deterministic local generated-model evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
