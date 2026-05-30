# RPP-0175 plugin-owned custom-table changes variant 4

Status: focused generated-harness regression proof added for variant 4.
Release remains NO-GO.

## Scenario

Variant 4 adds an explicit `pluginOwnedCustomTableChangesVariant4` target
coverage surface for deterministic plugin-owned forms-lab custom-table updates.
The variant-4 tag is emitted on the existing custom-table update target cases
so the generated summary exposes the surface with per-tier counts and both ready
and stale non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags forms-lab custom-table
  update cases with `plugin-owned-custom-table-variant4` plus ready, stale, and
  non-ready variant-4 tags, and exposes
  `summary.targetCoverage.pluginOwnedCustomTableChangesVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0175 plugin-owned
  custom-table changes variant 4 records surface and invariant`.
- The focused test recounts all variant-4 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  stale non-ready case for invariant checks.
- The ready selected case proves the `fixture-forms-lab-table` mutation carries
  owner/driver/delete-policy evidence, has a matching live-remote precondition,
  applies the local custom-table row hash, preserves the unplanned remote-only
  file, and rejects stale replay with `PRECONDITION_FAILED` before mutation.
- The stale selected case proves remote drift on the same plugin-owned
  custom-table row remains a plugin-data conflict, refuses apply with
  `PLAN_NOT_READY`, and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, owner/driver
  metadata, counts, row-id and field hashes, audit hashes, conflict hashes,
  refusal hashes, and remote-only preservation hashes. It omits raw
  custom-table payload values and remote-only file contents.

Deterministic target shape observed locally:

```json
{
  "pluginOwnedCustomTableChangesVariant4": {
    "family": "plugin-owned-custom-table-changes-variant4",
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
      "conflict": 5,
      "ready": 5
    }
  },
  "featureFamilies": {
    "plugin-owned-custom-table-variant4": 10,
    "plugin-owned-custom-table-variant4-ready": 5,
    "plugin-owned-custom-table-variant4-stale": 5,
    "plugin-owned-custom-table-variant4-non-ready": 5
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready custom-table case and one stale non-ready custom-table case",
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
node --test --test-name-pattern=RPP-0175 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent custom-table regression command:

```sh
node --test --test-name-pattern='RPP-0115|RPP-0135|RPP-0155|RPP-0175' test/generated-push-harness.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed full generated-harness result: 81 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0175-plugin-owned-custom-table-changes-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: checklist completion lint returned `"ok": true`, the
scoped redaction scan returned `"ok": true` with 0 rejected files, and both
diff whitespace checks reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
