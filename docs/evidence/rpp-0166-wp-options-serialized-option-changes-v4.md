# RPP-0166 wp_options serialized option changes variant 4

Status: focused generated-harness regression proof added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 adds an explicit `wpOptionsSerializedChangesVariant4` target coverage
surface for deterministic, regular, non-plugin-owned `wp_options` serialized
option updates. The variant-4 tag is emitted on both the ready serialized update
family and the conflicting remote-drift family so the summary proves the
generator records at least one ready and one non-ready case for this target.

## Evidence surface

- `scripts/harness/generated-push-cases.js` tags serialized option cases with
  `wp-options-serialized-v4` plus ready/non-ready variant-4 tags and exposes
  `summary.targetCoverage.wpOptionsSerializedChangesVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0166 wp_options serialized
  option changes variant 4 retains focused ready and non-ready regression
  coverage`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one non-ready conflict case for invariant checks.
- The ready selected case proves the generated serialized option mutation
  carries a matching precondition, applies the local serialized option hash,
  preserves unplanned remote data, and rejects stale replay with
  `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves the remote drift on the serialized option
  row remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the
  remote digest unchanged.
- The generated model evidence stores only resource keys, serialized shape
  kinds, counts, redaction metadata, hashes, conflict hashes, and refusal
  hashes. It omits raw serialized option payloads.

Deterministic target shape observed locally:

```json
{
  "wpOptionsSerializedChangesVariant4": {
    "family": "wp-options-serialized-variant4",
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
    "wp-options-serialized-v4": 20,
    "wp-options-serialized-v4-ready": 10,
    "wp-options-serialized-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready serialized option case and one non-ready serialized option conflict case",
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
node --test --test-name-pattern=RPP-0166 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Generated summary target check:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, wpOptionsSerializedChangesVariant4: summary.targetCoverage.wpOptionsSerializedChangesVariant4 }, null, 2));"
```

Observed summary result: 620 total cases, statuses `{ blocked: 74, conflict:
201, ready: 345 }`, and 20 `wpOptionsSerializedChangesVariant4` cases across
tiers 0 through 9.

Adjacent serialized option regression command:

```sh
node --test --test-name-pattern='RPP-0106|RPP-0126|RPP-0146|RPP-0166' test/generated-push-harness.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 73 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0166-wp-options-serialized-option-changes-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; the redaction scan reported no
rejected files for the changed docs.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
