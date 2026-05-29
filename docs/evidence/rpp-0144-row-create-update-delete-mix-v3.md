# RPP-0144 row create/update/delete mix variant 3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

Variant 3 adds an explicit `rowCreateUpdateDeleteMixVariant3` target coverage
surface for the deterministic generated row create/update/delete mix. The
variant-3 tag is emitted on both the ready family and the conflicting family so
the summary proves the generator emits ready and non-ready row mix cases across
all tiers.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags generic row mix cases with
  `row-create-update-delete-mix-v3` plus ready/non-ready variant-3 tags and
  exposes `summary.targetCoverage.rowCreateUpdateDeleteMixVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0144 row create/update/delete
  mix variant 3 rejects stale replay before mutation`.
- The focused test recounts all variant-3 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one non-ready conflict case for invariant checks.
- The ready selected case proves the generated row create/update/delete
  mutations apply local row hashes, preserve the remote-only row, and reject
  stale replay with `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves the remote drift on the updated row remains
  a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote digest
  unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits generated row
  payloads and conflicting remote row payloads.

Deterministic target shape observed locally:

```json
{
  "rowCreateUpdateDeleteMixVariant3": {
    "family": "row-create-update-delete-mix-variant3",
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
    "row-create-update-delete-mix-v3": 20,
    "row-create-update-delete-mix-v3-ready": 10,
    "row-create-update-delete-mix-v3-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready row mix case and one non-ready conflict row mix case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0144 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0144' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
