# RPP-0174 plugin-owned option changes variant 4

Status: focused generated-harness regression proof added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 adds an explicit `pluginOwnedOptionChangeVariant4` target coverage
surface for deterministic plugin-owned `wp_options` updates. The variant-4 tag
is emitted on both the ready plugin-owned option update family and the
conflicting remote-drift family, so the generated summary exposes per-tier
counts with both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` tags plugin-owned option changes
  with `plugin-owned-option-change-v4` plus ready/non-ready variant-4 tags and
  exposes `summary.targetCoverage.pluginOwnedOptionChangeVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0174 plugin-owned option
  changes variant 4 rejects stale replay before mutation`.
- The focused test recounts all variant-4 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  non-ready conflict case for invariant checks.
- The ready selected case proves the plugin-owned option mutation carries
  owner/driver evidence, has a matching live-remote precondition, applies the
  local option hash, preserves unplanned remote resources, and rejects stale
  replay with `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves the remote drift on the plugin-owned
  option row remains a plugin-data conflict, refuses apply with
  `PLAN_NOT_READY`, and leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, owner/driver
  metadata, counts, hashes, conflict hashes, and refusal hashes. It omits raw
  plugin-owned option values.

Deterministic target shape observed locally:

```json
{
  "pluginOwnedOptionChangeVariant4": {
    "family": "plugin-owned-option-change-variant4",
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
    "plugin-owned-option-change-v4": 20,
    "plugin-owned-option-change-v4-ready": 10,
    "plugin-owned-option-change-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready plugin-owned option case and one non-ready plugin-owned option conflict case",
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
node --test --test-name-pattern=RPP-0174 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0114|RPP-0134|RPP-0154|RPP-0174' test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0174-plugin-owned-option-changes-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused result: RPP-0174 reported 1 subtest, 0 failures.

Observed broader results:

- Adjacent plugin-owned option generated-harness slice reported 3 subtests, 0
  failures.
- `npm run test:generated-push-harness` reported 81 subtests, 0 failures.
- Checklist completion lint returned `"ok": true` with 0 risky claims.
- Scoped artifact redaction scan returned `"ok": true` with 0 rejected files.
- `git diff --check` and `git diff --cached --check` reported no whitespace
  errors.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
