# RPP-0154 plugin-owned option changes variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `pluginOwnedOptionChangeVariant3` target coverage
surface for deterministic plugin-owned `wp_options` updates. The variant-3 tag
is emitted on both the ready plugin-owned option update family and the
conflicting remote-drift family so the generated summary exposes the target
with per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags plugin-owned option
  changes with `plugin-owned-option-change-v3` plus ready/non-ready variant-3
  tags and exposes `summary.targetCoverage.pluginOwnedOptionChangeVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0154 plugin-owned option
  changes variant 3 rejects stale replay before mutation`.
- The focused test recounts all variant-3 target cases, cross-checks summary
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
  "pluginOwnedOptionChangeVariant3": {
    "family": "plugin-owned-option-change-variant3",
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
    "plugin-owned-option-change-v3": 20,
    "plugin-owned-option-change-v3-ready": 10,
    "plugin-owned-option-change-v3-non-ready": 10
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

Focused command:

```sh
node --test --test-name-pattern=RPP-0154 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0154' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 62 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
