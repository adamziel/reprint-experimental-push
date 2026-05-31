# RPP-0199 remote-only preservation release verifier v5

Date: 2026-05-31
Lane: RPP-0199 remote-only preservation release-verifier carry-through, variant 5
Checklist item: RPP-199 - Carry through the release verifier for remote-only preservation, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for
mutation-bearing `remote-only-post-update` cases. In each selected case the
remote changes a `wp_posts` row while local mutations target other resources.
The remote-only row must stay a `keep-remote` decision with no planned mutation
or live-remote precondition, and stale replay of the ready plan must fail before
any mutation runs.

The proof is local/support-only. It does not broaden the checked live
production boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`scripts/harness/generated-push-cases.js` exposes
`summary.targetCoverage.remoteOnlyPreservationReleaseVerifierVariant5`.

`test/generated-push-harness.test.js` proves the summary target is present and
matches the legacy and variant-3 remote-only preservation counts.

`test/rpp-0199-remote-only-preservation-release-verifier-v5.test.js` proves
that the release verifier:

- selects the 9 mutation-bearing remote-only preservation cases across tiers 1
  through 9;
- cross-checks release-verifier-v5 counts against the legacy and variant-3
  target counts;
- applies every selected ready plan while preserving the remote-only row on the
  remote hash;
- verifies the remote-only row has no planned mutation and no live-remote
  precondition;
- verifies every planned mutation has a matching live-remote precondition;
- drifts the final planned mutation after dry-run and rejects stale replay with
  `PRECONDITION_FAILED` before `beforeMutation` runs; and
- keeps evidence hash-only, excluding generated remote-only row titles, ready
  payload values, and stale replay payload values.

Observed deterministic target shape:

```json
{
  "target": "remoteOnlyPreservationReleaseVerifierVariant5",
  "family": "remote-only-preservation-release-verifier-v5",
  "sourceFamily": "remote-only-post-update",
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
  },
  "selectedModelEvidence": {
    "selectedCases": 9,
    "selection": "all mutation-bearing remote-only preservation release-verifier-v5 target cases",
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
node --check test/rpp-0199-remote-only-preservation-release-verifier-v5.test.js
node --test test/rpp-0199-remote-only-preservation-release-verifier-v5.test.js
node --test --test-name-pattern=RPP-0199 test/generated-push-harness.test.js
node --test --test-name-pattern='generated push harness covers|RPP-0199' test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0119|RPP-0139|RPP-0159|RPP-0199' test/generated-push-harness.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0199-remote-only-preservation-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0199 focused test reported 1 subtest, 0 failures.

Observed generated-harness result: RPP-0199 summary target test reported 1
subtest, 0 failures.

Observed generated coverage result: the required-family plus RPP-0199 slice
reported 2 subtests, 0 failures.

Observed adjacent remote-only result: RPP-0119, RPP-0139, RPP-0159, and
RPP-0199 reported 4 subtests, 0 failures.

Observed hygiene result: syntax checks exited 0, the scoped artifact redaction
scan returned `"ok": true`, and `git diff --check` reported no whitespace
errors.
