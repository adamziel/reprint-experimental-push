# RPP-0160 large ready plan tier variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `largeReadyPlanTierVariant3` target coverage surface
for the deterministic large-ready generated cases. The target is the same
10-case tiered surface proven by `largeReadyPlanTier`: post-row creates,
updates, and deletes; file creates, updates, and deletes; same-plan taxonomy and
comment graph rows; and remote-only row/file drift.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags large-ready cases with
  `large-ready-plan-v3` plus `large-ready-plan-v3-ready` and exposes
  `summary.targetCoverage.largeReadyPlanTierVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0160 large ready plan tier
  variant 3 records generated coverage surface`.
- The focused proof independently recounts all 10 variant-3 target cases and
  cross-checks total, per-tier counts, and statuses against both the variant-3
  summary target and the legacy `largeReadyPlanTier` target.
- For every tier, the proof verifies the exact generated row/file/taxonomy/
  comment surface, planned mutation keys, live-remote precondition keys,
  `keep-remote` decisions for the unplanned row/file drift, and stale replay
  refusal with `PRECONDITION_FAILED` before mutation.
- The generated model evidence stores only counts, resource keys, hashes,
  precondition hashes, decision hashes, and refusal-detail hashes. It omits raw
  generated row titles, file payloads, remote-only payloads, and stale replay
  payloads.

Deterministic target shape observed locally:

```json
{
  "largeReadyPlanTierVariant3": {
    "family": "large-ready-plan-tier-variant3",
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
    "perTierSelection": "all large ready plan variant-3 target cases",
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
node --check test/generated-push-harness.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test --test-name-pattern=RPP-0160 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Generated summary target check:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, largeReadyPlanTierVariant3: summary.targetCoverage.largeReadyPlanTierVariant3 }, null, 2));"
```

Observed summary result: 620 total cases, statuses `{ blocked: 74, conflict:
201, ready: 345 }`, and 10 ready `largeReadyPlanTierVariant3` cases across
tiers 0 through 9.

Adjacent large-ready regression command:

```sh
node --test --test-name-pattern='RPP-0120|RPP-0140|RPP-0160' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 67 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0160-large-ready-plan-tier-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; the redaction scan reported no
rejected files for the changed docs.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
