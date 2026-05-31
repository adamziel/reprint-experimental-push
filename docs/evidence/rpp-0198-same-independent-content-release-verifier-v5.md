# RPP-0198 same independent content release verifier v5

Date: 2026-05-31
Lane: RPP-0198 same independent content release-verifier carry-through, variant 5
Checklist item: RPP-198 - Carry through the release verifier for same independent content, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for ready plans
where local and remote independently update the same `wp_posts` row to identical
content. The synchronized row is an `already-in-sync` decision, so it must not
emit a mutation or live-remote precondition, while the rest of the ready plan
still applies and preserves all unplanned remote resources.

The proof is local/support-only. It does not broaden the checked live
production boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/generated-push-harness.test.js` proves that the release verifier:

- exposes `sameIndependentContentReleaseVerifierVariant5` target coverage with
  10 generated ready cases across tiers 0 through 9;
- cross-checks the release-verifier-v5 counts against the legacy, variant-3,
  and variant-4 same-independent-content targets;
- independently recounts the target and verifies the summary per-tier counts
  and ready status counts;
- applies every selected ready plan while the shared row stays on the remote
  hash with no mutation or live-remote precondition;
- enumerates the applied site to prove every unplanned resource still matches
  the pre-apply remote hash; and
- keeps evidence hash-only, excluding generated shared row titles, ready
  payload values, and remote-only preservation titles.

Observed deterministic target shape:

```json
{
  "target": "sameIndependentContentReleaseVerifierVariant5",
  "family": "same-independent-content-release-verifier-v5",
  "total": 10,
  "perTier": {
    "0": 1,
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
    "ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 10,
    "selection": "all same independent content release-verifier-v5 target cases",
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
node --test --test-name-pattern=RPP-0198 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0118|RPP-0138|RPP-0158|RPP-0178|RPP-0198' test/generated-push-harness.test.js
node --test --test-name-pattern='generated push harness covers|RPP-0198' test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0198-same-independent-content-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0198 reported 1 subtest, 0 failures.

Observed adjacent same-independent-content result: RPP-0118, RPP-0138,
RPP-0158, RPP-0178, and RPP-0198 reported 5 subtests, 0 failures.

Observed generated-harness result: the required-family plus RPP-0198 slice
reported 2 subtests, 0 failures, and `npm run test:generated-push-harness`
reported 92 subtests, 0 failures.

Observed hygiene result: syntax checks exited 0, the scoped artifact redaction
scan returned `"ok": true`, and `git diff --check` reported no whitespace
errors.
