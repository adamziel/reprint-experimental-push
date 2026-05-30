# RPP-0165 wp_options scalar option changes variant 4

Status: focused generated-harness regression proof added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 adds an explicit `wpOptionsScalarChangesVariant4` target coverage
surface for deterministic, regular, non-plugin-owned `wp_options` scalar option
updates. The variant-4 tag is emitted on both the ready scalar update family and
the conflicting remote-drift family so the summary proves the generator still
records the surface and invariant across all tiers.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags scalar option cases with
  `wp-options-scalar-v4` plus ready/non-ready variant-4 tags and exposes
  `summary.targetCoverage.wpOptionsScalarChangesVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0165 wp_options scalar option
  changes variant 4 records surface and invariant`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one non-ready conflict case for invariant checks.
- The ready selected case proves the generated scalar option mutation carries a
  matching live-remote precondition, applies the local scalar option hash,
  preserves unplanned remote data, and rejects stale replay with
  `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves the remote drift on the scalar option row
  remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote
  digest unchanged.
- The generated model evidence stores only resource keys, scalar value kinds,
  counts, hashes, conflict hashes, and refusal hashes. It omits scalar option
  payload values.

Deterministic target shape observed locally:

```json
{
  "wpOptionsScalarChangesVariant4": {
    "family": "wp-options-scalar-variant4",
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
    "wp-options-scalar-v4": 20,
    "wp-options-scalar-v4-ready": 10,
    "wp-options-scalar-v4-non-ready": 10
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

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0165 test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0145 test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0165-wp-options-scalar-option-changes-v4.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused result: RPP-0165 reported 1 subtest, 0 failures.

Observed broader results:

- Adjacent RPP-0145 generated-harness slice reported 1 subtest, 0 failures.
- `npm run test:generated-push-harness` reported 72 subtests, 0 failures.
- Checklist completion lint returned `"ok": true` with 0 risky claims.
- Scoped artifact redaction scan returned `"ok": true` with 0 rejected files.
- `git diff --check` and `git diff --cached --check` reported no whitespace
  errors.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
