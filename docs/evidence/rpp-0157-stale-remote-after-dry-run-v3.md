# RPP-0157 stale remote after dry-run variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `staleRemoteAfterDryRunVariant3` target coverage
surface for ready generated plans whose live-remote preconditions reject a stale
remote replay after dry-run and before mutation. The target intentionally
excludes zero-mutation ready plans because there is no planned resource to drift
between dry-run and apply.

## Evidence surface

- `scripts/harness/generated-push-cases.js` exposes
  `summary.targetCoverage.staleRemoteAfterDryRunVariant3` with the
  `ready-plan-stale-remote-after-dry-run-variant3` family label.
- `test/generated-push-harness.test.js` adds `RPP-0157 stale remote after
  dry-run variant 3 exposes per-tier hash-only replay refusals`.
- The focused test independently recounts all matching generated cases,
  cross-checks total, per-tier counts, and statuses against the generated
  summary, and cross-checks the variant-3 counts against the legacy stale-replay
  target.
- The proof selects one large multi-mutation ready case per tier, drifts the
  final planned mutation target after dry-run, asserts `PRECONDITION_FAILED`,
  and verifies the remote digest is unchanged so refusal happens before any
  mutation.
- The generated model evidence stores only resource keys, mutation/precondition
  hashes, refusal-detail hashes, tier counts, and status counts. It omits raw
  local, remote, and stale replay payload values.

Deterministic target shape observed locally:

```json
{
  "staleRemoteAfterDryRunVariant3": {
    "family": "ready-plan-stale-remote-after-dry-run-variant3",
    "total": 344,
    "perTier": {
      "0": 34,
      "1": 34,
      "2": 35,
      "3": 34,
      "4": 35,
      "5": 34,
      "6": 35,
      "7": 34,
      "8": 35,
      "9": 34
    },
    "statuses": {
      "ready": 344
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 10,
    "selection": "one multi-mutation ready stale-replay refusal per tier, drifting the final planned mutation",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0157 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0157' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Adjacent stale-remote regression command:

```sh
node --test --test-name-pattern='RPP-0117|RPP-0137|RPP-0157' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 64 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
