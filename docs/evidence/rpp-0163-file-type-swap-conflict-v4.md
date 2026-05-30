# RPP-0163 file type-swap conflict variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `fileTypeSwapConflictVariant4` target coverage
surface for deterministic file topology type swaps. The target tags both the
ready directory-to-file swap family and the remote-descendant conflict family so
the summary proves the generator still emits ready and non-ready cases for this
surface.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags type-swap cases with
  `file-type-swap-conflict-v4` plus ready/non-ready variant-4 tags and exposes
  `summary.targetCoverage.fileTypeSwapConflictVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0163 file type-swap conflict
  variant 4 proves ready preservation and refused conflicts`.
- The focused test recounts all variant-4 target cases, cross-checks summary
  total, per-tier counts, and statuses, then selects one ready case with a
  concrete unplanned remote preservation proof and one non-ready remote
  descendant conflict.
- Ready evidence proves the type-swap mutation carries a live-remote
  precondition, applies the planned file hash, preserves an unplanned remote
  resource, and rejects stale replay before mutation.
- Non-ready evidence proves the remote descendant stays a topology conflict,
  carries no planned mutation or precondition for the conflicted target, refuses
  apply with `PLAN_NOT_READY`, and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits generated file
  payloads, remote descendant payloads, and remote preserve row values.

Deterministic target shape observed locally:

```json
{
  "fileTypeSwapConflictVariant4": {
    "family": "file-type-swap-conflict-variant4",
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
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready preserved type-swap case and one non-ready remote-descendant conflict",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0163 test/generated-push-harness.test.js
```

Adjacent generated-harness command:

```sh
node --test --test-name-pattern='RPP-0103|RPP-0123|RPP-0163' test/generated-push-harness.test.js
```

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed local results: focused RPP-0163 reported 1 subtest with 0 failures,
the adjacent file type-swap harness reported 3 subtests with 0 failures, and
the full generated-harness check reported 67 subtests with 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
