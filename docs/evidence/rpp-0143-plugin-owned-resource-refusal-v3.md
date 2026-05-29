# RPP-0143 plugin-owned resource refusal variant 3

Status: focused generated-harness proof added for variant 3. Release remains NO-GO.

## Scenario

Variant 3 adds an explicit `pluginOwnedResourceRefusalVariant3` target coverage
surface for plugin-owned `wp_options` rows owned by `forms`.

The deterministic roster emits 30 target cases: one ready, one changed/blocked,
and one stale/conflict case in every tier. The summary target is explicit:

- `total: 30`;
- `perTier: { 0..9: 3 }`;
- `statuses: { ready: 10, blocked: 10, conflict: 10 }`;
- tags split the surface into `plugin-owned-resource-refusal-v3-ready`,
  `plugin-owned-resource-refusal-v3-changed`, and
  `plugin-owned-resource-refusal-v3-stale`.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now emits ready, changed, and stale
  RPP-0143 target rows and exposes
  `summary.targetCoverage.pluginOwnedResourceRefusalVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0143 plugin-owned resource
  refusal variant 3 exposes ready changed and stale generated coverage`.
- The focused test recounts all variant-3 target cases, cross-checks summary
  totals, per-tier counts, statuses, and variant tags, then selects one ready,
  one changed/blocked, and one stale/conflict case.
- Ready evidence proves the supported `wp-option` target applies with owner and
  driver evidence, then rejects stale replay with `PRECONDITION_FAILED` before
  mutation.
- Changed evidence proves the missing driver policy fails closed as
  `UNKNOWN_PLUGIN_OWNED_RESOURCE`, carries no target mutation/precondition, and
  refuses apply with `PLAN_NOT_READY`.
- Stale evidence proves concurrent remote drift stays `conflict`, carries no
  target mutation/precondition, and refuses apply with `PLAN_NOT_READY`.
- The generated model evidence stores only resource keys, counts, hashes,
  blocker/conflict/refusal hashes, and proof hashes. It omits the generated
  private option tokens for ready, changed, stale, and stale-replay paths.

Deterministic target shape observed locally:

```json
{
  "pluginOwnedResourceRefusalVariant3": {
    "family": "plugin-owned-resource-refusal-variant3",
    "total": 30,
    "perTier": {
      "0": 3,
      "1": 3,
      "2": 3,
      "3": 3,
      "4": 3,
      "5": 3,
      "6": 3,
      "7": 3,
      "8": 3,
      "9": 3
    },
    "statuses": {
      "blocked": 10,
      "conflict": 10,
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 3,
    "selection": "one ready, one changed/blocked, and one stale/conflict plugin-owned target case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0143 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
