# RPP-0142 directory descendant conflict variant 3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

Variant 3 adds an explicit `directoryDescendantConflictVariant3` target coverage
surface for generated local directory deletes. The target tag is emitted for both
ready deletes where the remote directory has no descendant and non-ready cases
where the remote creates a descendant beneath the directory before push apply.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags the directory descendant
  target with `directory-descendant-v3`, plus ready and non-ready variant-3 tags,
  and exposes `summary.targetCoverage.directoryDescendantConflictVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0142 directory descendant
  conflict variant 3 exposes per-tier generated coverage`.
- The focused test recounts all variant-3 target cases, cross-checks the summary
  total, per-tier counts, and statuses, then selects one ready directory delete
  case and one non-ready descendant conflict case.
- The ready selected case proves the planned directory delete applies, preserves
  unplanned remote data, and rejects stale replay before mutation.
- The non-ready selected case proves the remote descendant remains
  `keep-remote`, the directory delete has no planned mutation, `applyPlan()`
  refuses with `PLAN_NOT_READY`, and the remote digest is unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits the generated
  remote descendant file payload.

Deterministic target shape observed locally:

```json
{
  "directoryDescendantConflictVariant3": {
    "family": "directory-descendant-conflict-variant3",
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
    "selection": "one ready directory delete case and one non-ready descendant conflict case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0142 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
