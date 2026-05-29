# RPP-0148 wp_postmeta create/update/delete variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `wpPostmetaCreateUpdateDeleteVariant3` target
coverage surface for deterministic, regular `wp_postmeta` create/update/delete
changes. The variant-3 tag is emitted on both the ready postmeta
create/update/delete family and the conflicting remote-drift family so the
generated summary exposes the target with per-tier counts and both ready and
non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags `wp_postmeta`
  create/update/delete cases with `wp-postmeta-create-update-delete-v3` plus
  ready/non-ready variant-3 tags and exposes
  `summary.targetCoverage.wpPostmetaCreateUpdateDeleteVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0148 wp_postmeta
  create/update/delete variant 3 records per-tier surface coverage`.
- The focused test recounts all variant-3 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  non-ready conflict case for invariant checks.
- The ready selected case proves the generated postmeta create, update, and
  delete mutations each carry matching preconditions, apply the local
  `wp_postmeta` hash, preserve unplanned remote data, and reject stale replay
  with `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves remote drift on the updated `wp_postmeta`
  row remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the
  remote digest unchanged.
- The generated model evidence stores only resource keys, parent post IDs,
  meta-key hashes, counts, hashes, conflict hashes, and refusal hashes. It omits
  raw postmeta values.

Deterministic target shape observed locally:

```json
{
  "wpPostmetaCreateUpdateDeleteVariant3": {
    "family": "wp-postmeta-create-update-delete-variant3",
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
    "wp-postmeta-create-update-delete-v3": 20,
    "wp-postmeta-create-update-delete-v3-ready": 10,
    "wp-postmeta-create-update-delete-v3-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready wp_postmeta create/update/delete case and one non-ready wp_postmeta conflict case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0148 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0148' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
