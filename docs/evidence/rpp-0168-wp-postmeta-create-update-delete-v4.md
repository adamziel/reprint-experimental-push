# RPP-0168 wp_postmeta create/update/delete variant 4

Status: focused generated-harness regression proof added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 adds an explicit `wpPostmetaCreateUpdateDeleteVariant4` target
coverage surface for deterministic `wp_postmeta` create/update/delete changes.
The variant-4 tag is emitted on both the ready postmeta create/update/delete
family and the conflicting remote-drift family so the summary exposes per-tier
counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags `wp_postmeta`
  create/update/delete cases with `wp-postmeta-create-update-delete-v4` plus
  ready/non-ready variant-4 tags and exposes
  `summary.targetCoverage.wpPostmetaCreateUpdateDeleteVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0168 wp_postmeta
  create/update/delete variant 4 applies ready changes without unplanned
  overwrite`.
- The focused test recounts all variant-4 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  non-ready conflict case for invariant checks.
- The ready selected case proves the generated postmeta create, update, and
  delete mutations each carry matching live-remote preconditions, apply the
  local `wp_postmeta` hash, preserve unplanned remote data, and reject stale
  replay with `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves remote drift on the updated
  `wp_postmeta` row remains a conflict, refuses apply with `PLAN_NOT_READY`,
  and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, parent post IDs,
  meta-key hashes, counts, hashes, conflict hashes, and refusal hashes. It
  omits raw postmeta values.

Deterministic target shape observed locally:

```json
{
  "wpPostmetaCreateUpdateDeleteVariant4": {
    "family": "wp-postmeta-create-update-delete-variant4",
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
    "wp-postmeta-create-update-delete-v4": 20,
    "wp-postmeta-create-update-delete-v4-ready": 10,
    "wp-postmeta-create-update-delete-v4-non-ready": 10
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

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0168 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0108/RPP-0128|RPP-0148' test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0168-wp-postmeta-create-update-delete-v4.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused result: RPP-0168 reported 1 subtest, 0 failures.

Observed broader results:

- Adjacent postmeta generated-harness checks for RPP-0108/RPP-0128 and
  RPP-0148 reported 2 subtests, 0 failures.
- `npm run test:generated-push-harness` reported 75 subtests, 0 failures.
- Checklist completion lint returned `"ok": true` with 0 risky claims.
- Scoped artifact redaction scan returned `"ok": true` with 0 rejected files.
- `git diff --check` and `git diff --cached --check` reported no whitespace
  errors.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
