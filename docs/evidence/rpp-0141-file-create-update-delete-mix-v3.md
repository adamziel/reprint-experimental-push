# RPP-0141 file create/update/delete mix variant 3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

Variant 3 adds an explicit `fileCreateUpdateDeleteMixVariant3` target coverage
surface for the deterministic generated file create/update/delete mix. The
variant-3 tag is emitted on both the ready family and the conflicting family so
the summary proves the generator still emits at least one ready case and one
non-ready case for this target.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags file mix cases with
  `file-create-update-delete-mix-v3` plus ready/non-ready variant-3 tags and
  exposes `summary.targetCoverage.fileCreateUpdateDeleteMixVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0141 file create/update/delete
  mix variant 3 emits ready and non-ready generated coverage`.
- The focused test recounts all variant-3 target cases, cross-checks the summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  non-ready conflict case for invariant checks.
- The ready selected case proves the generated create/update/delete file
  mutations apply local hashes, preserve the remote-only file, and reject stale
  replay before mutation.
- The non-ready selected case proves the remote drift on the updated file
  remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote
  digest unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits generated file
  payloads and conflicting remote file payloads.

Deterministic target shape observed locally:

```json
{
  "fileCreateUpdateDeleteMixVariant3": {
    "family": "file-create-update-delete-mix-variant3",
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
    "selection": "one ready file mix case and one non-ready conflict file mix case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0141 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
