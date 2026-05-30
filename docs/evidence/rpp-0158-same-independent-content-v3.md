# RPP-0158 same independent content variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `sameIndependentContentVariant3` target coverage
surface for ready generated cases where local and remote independently update
the same `wp_posts` row to identical content. The planner should record the row
as already in sync, avoid a mutation or live-remote precondition for that row,
apply the rest of the ready plan, and preserve every unplanned remote resource.

## Evidence surface

- `scripts/harness/generated-push-cases.js` exposes
  `summary.targetCoverage.sameIndependentContentVariant3` with the
  `same-independent-content-variant3` family label.
- `test/generated-push-harness.test.js` adds `RPP-0158 same independent content
  variant 3 applies ready cases without unplanned remote overwrite`.
- The focused test independently recounts all variant-3 target cases,
  cross-checks total, per-tier counts, and statuses against the generated
  summary, and cross-checks those counts against the legacy
  `sameIndependentContent` target.
- For every selected case, the proof applies the ready plan, verifies the shared
  row keeps the remote hash with no mutation or precondition, and enumerates the
  applied site to prove every unplanned resource still matches the remote hash.
- The generated model evidence stores only resource keys, counts, row hashes,
  decision hashes, and unplanned-preservation proof hashes. It omits raw row
  titles and generated payload values.

Deterministic target shape observed locally:

```json
{
  "sameIndependentContentVariant3": {
    "family": "same-independent-content-variant3",
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
    "selectedCases": 10,
    "selection": "all same independent content variant-3 target cases",
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
node --test --test-name-pattern=RPP-0158 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0158' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Adjacent same-independent-content regression command:

```sh
node --test --test-name-pattern='RPP-0118|RPP-0138|RPP-0158' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 65 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
