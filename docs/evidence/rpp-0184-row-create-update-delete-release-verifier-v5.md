# RPP-0184 Row Create/Update/Delete Release Verifier V5 Evidence

Date: 2026-05-30

Scope: local generated-model/support evidence only. The release remains NO-GO
until the required live topology/auth evidence is supplied.

## Proof Surface

- Adds `rowCreateUpdateDeleteMixReleaseVerifierVariant5` target coverage for the
  generated row create/update/delete mix surface.
- Emits 20 deterministic target cases: 10 ready cases and 10 non-ready conflict
  cases, with two cases in every tier from 0 through 9.
- Ready proof verifies the planned row create, update, and delete mutations,
  preserves the unplanned remote-only row, and rejects stale replay with
  `PRECONDITION_FAILED` before the mutation callback is reached.
- Non-ready proof verifies the conflicting updated row has no planned mutation
  or precondition and that apply refuses with `PLAN_NOT_READY` before the
  mutation callback is reached.
- Evidence is hash-only for generated row payloads and records resource keys,
  planner summaries, decision/refusal hashes, and model proof hashes.

## Harness Summary

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "rowCreateUpdateDeleteMixReleaseVerifierVariant5": {
    "family": "row-create-update-delete-mix-release-verifier-v5",
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

## Validation

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0184-row-create-update-delete-release-verifier-v5.test.js
node --test test/rpp-0184-row-create-update-delete-release-verifier-v5.test.js
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, rowCreateUpdateDeleteMixReleaseVerifierVariant5: summary.targetCoverage.rowCreateUpdateDeleteMixReleaseVerifierVariant5 }, null, 2));"
node --test --test-name-pattern='RPP-0144|RPP-0164|RPP-0184' test/generated-push-harness.test.js test/rpp-0184-row-create-update-delete-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0184-row-create-update-delete-release-verifier-v5.md
git diff --check
```
