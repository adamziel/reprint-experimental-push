# RPP-0164 row create/update/delete mix variant 4

Date: 2026-05-30
Lane: RPP-0164 row create/update/delete mix, variant 4
Checklist item: RPP-0164 - Add focused regression coverage for row create/update/delete mix, variant 4.

## Scope

This is local generated-harness regression evidence for the generic row
create/update/delete mix. It validates deterministic planner/apply behavior only;
it does not update production release posture or progress surfaces.

## Proof surface

- `scripts/harness/generated-push-cases.js` now emits
  `row-create-update-delete-mix-v4` on the existing ready and conflict row-mix
  families, with ready and non-ready variant-4 sub-tags.
- `summary.targetCoverage.rowCreateUpdateDeleteMixVariant4` reports 20 target
  cases: 10 ready cases and 10 non-ready conflict cases, with two cases in each
  tier from 0 through 9.
- `test/generated-push-harness.test.js` adds `RPP-0164 row create/update/delete
  mix variant 4 rejects stale replay before mutation`.
- The focused proof selects one ready row-mix case and one non-ready conflict
  case, then records only resource keys, planner summaries, row hashes, decision
  hashes, refusal hashes, and model proof hashes.
- The ready case proves the generated create/update/delete row mutations apply,
  the remote-only row is preserved, and stale remote replay raises
  `PRECONDITION_FAILED` before mutation.
- The non-ready case proves remote drift on the updated row remains a conflict,
  `applyPlan()` refuses the plan with `PLAN_NOT_READY`, and the remote digest is
  unchanged.

Deterministic target shape observed locally:

```json
{
  "rowCreateUpdateDeleteMixVariant4": {
    "family": "row-create-update-delete-mix-variant4",
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
    "row-create-update-delete-mix-v4": 20,
    "row-create-update-delete-mix-v4-ready": 10,
    "row-create-update-delete-mix-v4-non-ready": 10
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

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0164 test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0144 test/generated-push-harness.test.js
npm run test:generated-push-harness
```

Observed result: all commands exited 0. The focused RPP-0164 test reported 1
subtest ok and 0 failures. The adjacent RPP-0144 row-mix slice reported 1
subtest ok and 0 failures. The full generated harness reported 71 subtests ok
and 0 failures.

## Release posture

This remains local generated-model evidence only. It is not live production
evidence, and the broader release gate remains NO-GO until separate
production-backed release-verifier proof exists.
