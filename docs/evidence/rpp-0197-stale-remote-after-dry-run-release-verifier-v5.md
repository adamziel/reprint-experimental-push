# RPP-0197 stale remote after dry-run release verifier v5

Date: 2026-05-31
Lane: RPP-0197 stale remote after dry-run release-verifier carry-through, variant 5
Checklist item: RPP-197 - Carry through the release verifier for stale remote after dry-run, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for ready plans
whose live-remote preconditions reject a stale remote replay after dry-run and
before mutation. The target excludes zero-mutation ready plans because there is
no planned resource to drift between dry-run and apply.

The proof is local/support-only. It does not broaden the checked live
production boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/generated-push-harness.test.js` proves that the release verifier:

- exposes `staleRemoteAfterDryRunReleaseVerifierVariant5` target coverage with
  344 generated ready replay-refusal cases across tiers 0 through 9;
- cross-checks the release-verifier-v5 counts against the legacy,
  variant-3, and variant-4 stale remote after dry-run targets;
- independently recounts the target and verifies the summary per-tier counts
  and ready status counts;
- selects the highest-mutation-count ready case in each tier, drifts a
  midpoint planned mutation after dry-run, and observes
  `PRECONDITION_FAILED` before mutation;
- verifies the stale replay leaves the whole remote digest unchanged; and
- keeps evidence hash-only, excluding generated local, remote, and stale replay
  payload values.

Observed deterministic target shape:

```json
{
  "target": "staleRemoteAfterDryRunReleaseVerifierVariant5",
  "family": "ready-plan-stale-remote-after-dry-run-release-verifier-v5",
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

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0197 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0117|RPP-0137|RPP-0157|RPP-0177|RPP-0197' test/generated-push-harness.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0197-stale-remote-after-dry-run-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0197 reported 1 subtest, 0 failures.

Observed adjacent stale-remote result: RPP-0117, RPP-0137, RPP-0157,
RPP-0177, and RPP-0197 reported 5 subtests, 0 failures.

Observed hygiene result: syntax checks exited 0, the scoped artifact redaction
scan returned `"ok": true`, and `git diff --check` reported no whitespace
errors.
