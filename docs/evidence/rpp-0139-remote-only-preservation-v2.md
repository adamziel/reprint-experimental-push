# RPP-0139 remote-only preservation variant 2

Status: focused generated-harness proof added for variant 2. Release remains NO-GO.

## Scenario

Variant 2 proves the existing `remoteOnlyPreservation` generated-harness target from the deterministic case roster. The target is every mutation-bearing `remote-only-post-update` case where a remote `wp_posts` row changes while local mutations affect other resources.

Tier 0 remains a zero-mutation preservation case. It is intentionally outside this stale replay target because there is no planned mutation to drift after dry-run.

## Evidence surface

- `test/generated-push-harness.test.js` adds `RPP-0139 remote-only preservation variant 2 proves stale replay refusal before mutation`.
- The focused proof independently recounts all remote-only preservation target cases and cross-checks `summary.targetCoverage.remoteOnlyPreservation`.
- For each tier 1 through 9, the proof verifies the remote-only row is a `keep-remote` decision, the row has no planned mutation or precondition, apply preserves the remote row hash, and a later planned mutation carries the replay precondition.
- The stale replay mutates that later planned resource after dry-run and asserts `PRECONDITION_FAILED` with identical before/after remote digests, proving refusal happens before mutation.
- The generated model evidence stores only resource keys, summary counts, decisions, hashes, precondition hashes, and error-detail hashes. It omits raw remote-only row titles, generated file payloads, and stale replay payloads.

Deterministic target shape observed locally:

```json
{
  "remoteOnlyPreservation": {
    "family": "remote-only-post-update",
    "total": 9,
    "perTier": {
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
      "ready": 9
    }
  },
  "selectedModelEvidence": {
    "cases": 9,
    "perTierSelection": "one mutation-bearing remote-only preservation case per tier 1 through 9",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0139 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 44 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not replace release-gate, integration-lane, or production-backed validation.
