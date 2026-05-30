# RPP-0180 large ready plan tier variant 4

Status: focused generated-harness regression proof added for variant 4.
Release remains NO-GO.

## Scenario

Variant 4 adds an explicit `largeReadyPlanTierVariant4` target coverage surface
for the deterministic large-ready generated cases. The target is the same
10-case tiered surface proven by `largeReadyPlanTier` and
`largeReadyPlanTierVariant3`: post-row creates, updates, and deletes; file
creates, updates, and deletes; same-plan taxonomy and comment graph rows; and
remote-only row/file drift.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags large-ready cases with
  `large-ready-plan-v4` plus `large-ready-plan-v4-ready` and exposes
  `summary.targetCoverage.largeReadyPlanTierVariant4`.
- `test/rpp-0180-large-ready-plan-tier-v4.test.js` adds focused regression
  coverage for the variant-4 target.
- The proof independently recounts all 10 variant-4 target cases and
  cross-checks total, per-tier counts, and statuses against the variant-4
  summary target, `largeReadyPlanTierVariant3`, and legacy
  `largeReadyPlanTier`.
- For every tier, the proof verifies exact row/file/taxonomy/comment surface
  counts, planned mutation keys, live-remote precondition keys, `keep-remote`
  decisions for unplanned row/file drift, and stale replay refusal with
  `PRECONDITION_FAILED` before mutation.
- The generated model evidence stores counts and hashes for resource-key sets,
  preconditions, planned values, decisions, and refusal details. It omits raw
  generated row titles, file payloads, remote-only payloads, and stale replay
  payloads.

Deterministic target shape observed locally:

```json
{
  "largeReadyPlanTierVariant4": {
    "family": "large-ready-plan-tier-variant4",
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
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "cases": 10,
    "perTierSelection": "all large ready plan variant-4 target cases",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0180-large-ready-plan-tier-v4.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test test/rpp-0180-large-ready-plan-tier-v4.test.js
```

Observed focused result: 1 subtest, 0 failures.

Generated summary target check:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, largeReadyPlanTierVariant4: summary.targetCoverage.largeReadyPlanTierVariant4, largeReadyPlanTierVariant3: summary.targetCoverage.largeReadyPlanTierVariant3, largeReadyPlanTier: summary.targetCoverage.largeReadyPlanTier }, null, 2));"
```

Observed summary result: 620 total cases, statuses `{ blocked: 74, conflict:
201, ready: 345 }`, and 10 ready `largeReadyPlanTierVariant4` cases across
tiers 0 through 9. The variant-4 target matches both
`largeReadyPlanTierVariant3` and legacy `largeReadyPlanTier`.

Adjacent large-ready regression command:

```sh
node --test --test-name-pattern='RPP-0120|RPP-0140|RPP-0160' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0180-large-ready-plan-tier-v4.md
git diff --check
```

Observed hygiene result: both commands exited 0; the redaction scan reported no
rejected files for the changed docs.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
