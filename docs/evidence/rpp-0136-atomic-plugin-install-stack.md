# RPP-0136 atomic plugin install stack variant 2

Status: focused generated-harness proof added for variant 2. Release remains NO-GO.

## Scenario

Variant 2 now has a dedicated generated-harness target over the existing atomic plugin install stack model. The target selects both deterministic stack shapes:

- ready stack: dependency plugin file, dependent plugin file, both plugin metadata records, and the plugin-owned option row stay in one `requireAtomic` plugin-install intent; the dependency requirement resolves from the same atomic group.
- non-ready stack: the dependent plugin is staged without the dependency plugin; the planner leaves the atomic group blocked, emits missing-dependency evidence, and propagates the atomic blocker to grouped plugin metadata so apply refuses before any remote mutation.

## Evidence surface

- `scripts/harness/generated-push-cases.js` adds the variant-2 target coverage key plus v2 tags:
  - `atomic-plugin-install-stack-v2`
  - `atomic-plugin-stack-ready-v2`
  - `atomic-plugin-stack-missing-dependency-v2`
- `test/generated-push-harness.test.js` adds the `RPP-0136` focused proof, selecting one ready generated case and one non-ready generated case from the real harness fixtures.
- The emitted evidence envelope is local/generated/model-only: it records hashes, statuses, resource keys, dependency sources, and blocker classes, while raw plugin file contents and option payload values remain outside the artifact.

Deterministic target shape observed locally:

```json
{
  "atomicPluginInstallStackV2": {
    "family": "atomic-plugin-stack-ready",
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
      "blocked": 2,
      "conflict": 8,
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "readyCases": 1,
    "nonReadyCases": 1,
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0136 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 40 subtests, 0 failures.
