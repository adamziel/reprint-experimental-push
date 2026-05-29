# RPP-0145 wp_options scalar option changes variant 3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

Variant 3 adds an explicit `wpOptionsScalarChangesVariant3` target coverage
surface for deterministic, regular, non-plugin-owned `wp_options` scalar option
updates. The variant-3 tag is emitted on both the ready scalar update family and
the conflicting remote-drift family so the summary proves the generator records
the surface and invariant across all tiers.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags scalar option cases with
  `wp-options-scalar-v3` plus ready/non-ready variant-3 tags and exposes
  `summary.targetCoverage.wpOptionsScalarChangesVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0145 wp_options scalar option
  changes variant 3 records surface and invariant`.
- The focused test recounts all variant-3 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one non-ready conflict case for invariant checks.
- The ready selected case proves the generated scalar option mutation carries a
  matching precondition, applies the local scalar option hash, preserves
  unplanned remote data, and rejects stale replay with `PRECONDITION_FAILED`
  before mutation.
- The non-ready selected case proves the remote drift on the scalar option row
  remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote
  digest unchanged.
- The generated model evidence stores only resource keys, scalar value kinds,
  counts, hashes, conflict hashes, and refusal hashes. It omits scalar option
  payload values.

Deterministic target shape observed locally:

```json
{
  "wpOptionsScalarChangesVariant3": {
    "family": "wp-options-scalar-variant3",
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
  },
  "featureFamilies": {
    "wp-options-scalar-v3": 20,
    "wp-options-scalar-v3-ready": 10,
    "wp-options-scalar-v3-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready scalar option case and one non-ready scalar option conflict case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0145 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0145' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
