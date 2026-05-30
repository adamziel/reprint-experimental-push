# RPP-0186 WP Options Serialized Release Verifier V5 Evidence

Date: 2026-05-30

Scope: local generated-model/support evidence only. The release remains NO-GO
until the required live topology/auth evidence is supplied.

## Proof Surface

- Adds `wpOptionsSerializedChangesReleaseVerifierVariant5` target coverage for
  the generated regular `wp_options` serialized option update surface.
- Emits 20 deterministic target cases: 10 ready serialized option updates and
  10 non-ready remote-drift conflicts, with two cases in every tier from 0
  through 9.
- Ready proof verifies the planned `wp_options` row update mutation, its
  live-remote precondition, unplanned remote preservation, and stale replay
  refusal with `PRECONDITION_FAILED` before the mutation callback is reached.
- Non-ready proof verifies the conflicting serialized option has no planned
  mutation or precondition and that apply refuses with `PLAN_NOT_READY` before
  the mutation callback is reached.
- Evidence is hash-only for generated serialized option payloads and records
  resource keys, serialized shape kinds, planner summaries, redaction metadata,
  mutation/conflict hashes, refusal hashes, and model proof hashes.

## Harness Summary

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "wpOptionsSerializedChangesReleaseVerifierVariant5": {
    "family": "wp-options-serialized-release-verifier-v5",
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
node --check test/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.test.js
node --test test/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.test.js
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, wpOptionsSerializedChangesReleaseVerifierVariant5: summary.targetCoverage.wpOptionsSerializedChangesReleaseVerifierVariant5 }, null, 2));"
node --test --test-name-pattern='RPP-0146|RPP-0166|RPP-0186' test/generated-push-harness.test.js test/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.md docs/generated-push-harness.md
git diff --check
```
