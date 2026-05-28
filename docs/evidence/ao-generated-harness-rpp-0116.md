# Generated harness evidence for RPP-0116

Date: 2026-05-28
Lane: RPP-0116 generated harness
Checklist item: RPP-0116 — Implement atomic plugin install stack, variant 1.

Status note: this is local generated/model evidence toward the checklist target; the release gate remains held separately and the checklist item remains unchecked here.

## What changed

- Added deterministic variant-1 tags for the existing atomic plugin install stack generated target:
  - `atomic-plugin-install-stack-v1`
  - `atomic-plugin-stack-ready-v1`
  - `atomic-plugin-stack-missing-dependency-v1`
- Added `summary.targetCoverage.atomicPluginInstallStackV1`, keyed to the variant-1 tag.
- Added focused generated-model assertions that select one ready stack and one non-ready missing-dependency stack from the real harness cases.
- The ready stack keeps dependency and dependent plugin files, plugin metadata, and plugin-owned option data inside one atomic group.
- The non-ready stack omits the dependency plugin and verifies apply refusal without mutating the remote model.
- The evidence envelope stores hashes, statuses, resource keys, and blocker classes only; raw plugin file and option payload values remain out of artifacts.

## Focused proof

Focused command:

```sh
node --test --test-name-pattern=RPP-0116 test/generated-push-harness.test.js
```

Additional generated summary command:

```sh
node scripts/harness/generated-push-cases.js
```

Observed deterministic target shape after the change:

```json
{
  "targetCoverage": {
    "atomicPluginInstallStackV1": {
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
