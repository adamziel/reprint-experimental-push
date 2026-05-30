# RPP-0177 stale remote after dry-run variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `staleRemoteAfterDryRunVariant4` target coverage
surface for ready generated plans whose live-remote preconditions reject a stale
remote replay after dry-run and before mutation. The target excludes
zero-mutation ready plans because there is no planned resource to drift between
dry-run and apply.

## Evidence surface

- `scripts/harness/generated-push-cases.js` exposes
  `summary.targetCoverage.staleRemoteAfterDryRunVariant4` with the
  `ready-plan-stale-remote-after-dry-run-variant4` family label.
- `test/generated-push-harness.test.js` adds `RPP-0177 stale remote after
  dry-run variant 4 exposes per-tier midpoint replay refusals`.
- The focused proof independently recounts all matching generated cases,
  cross-checks total, per-tier counts, and statuses against the generated
  summary, and cross-checks the variant-4 counts against the legacy and
  variant-3 stale-replay targets.
- The proof selects the highest-mutation-count ready case in each tier, drifts
  a midpoint planned mutation target after dry-run, asserts
  `PRECONDITION_FAILED`, and verifies the remote digest is unchanged so refusal
  happens before any mutation.
- The generated model evidence stores only resource keys,
  mutation/precondition hashes, refusal-detail hashes, tier counts, status
  counts, and model proof hashes. It omits raw local, remote, and stale replay
  payload values.

Deterministic target shape observed locally:

```json
{
  "staleRemoteAfterDryRunVariant4": {
    "family": "ready-plan-stale-remote-after-dry-run-variant4",
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
    "selection": "highest-mutation-count ready case per tier, drifting a midpoint planned mutation",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0177 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent stale-remote regression command:

```sh
node --test --test-name-pattern='RPP-0117|RPP-0137|RPP-0157|RPP-0177' test/generated-push-harness.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 84 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
