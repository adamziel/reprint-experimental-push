# RPP-0137 stale remote after dry-run variant 2

Status: focused generated-harness proof added for variant 2. Release remains NO-GO.

## Scenario

Variant 2 proves the existing `staleRemoteAfterDryRun` generated-harness target from the summary surface. The target is any ready generated plan with at least one planned mutation where a remote drift after dry-run causes apply-time live-hash revalidation to reject with `PRECONDITION_FAILED` before mutation.

Zero-mutation ready plans remain excluded because there is no planned mutation target to drift after dry-run.

## Evidence surface

- `test/generated-push-harness.test.js` adds `RPP-0137 stale remote after dry-run variant 2 proves hash-only per-tier replay refusals`.
- The focused test independently revalidates every generated case that matches the stale-replay target and cross-checks the derived totals against `summary.targetCoverage.staleRemoteAfterDryRun`.
- The same test selects one matching ready case per tier, drifts the first planned mutation target after dry-run, asserts `PRECONDITION_FAILED`, and verifies the remote digest is unchanged after refusal.
- The generated model evidence stores only resource keys, status, summary counts, hashes, and hash digests of preconditions/error details. It omits raw local, remote, and stale replay payloads.

Deterministic target shape observed locally:

```json
{
  "staleRemoteAfterDryRun": {
    "family": "ready-plan-stale-remote-after-dry-run",
    "total": 354,
    "perTier": {
      "0": 35,
      "1": 35,
      "2": 36,
      "3": 35,
      "4": 36,
      "5": 35,
      "6": 36,
      "7": 35,
      "8": 36,
      "9": 35
    },
    "statuses": {
      "ready": 354
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 10,
    "perTierSelection": "one ready stale-replay refusal per tier",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0137 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 41 subtests, 0 failures.
