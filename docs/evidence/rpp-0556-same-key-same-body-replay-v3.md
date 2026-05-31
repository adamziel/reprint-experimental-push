# RPP-0556 same-key same-body replay, variant 3

Date: 2026-05-31

Status: deterministic local support-only generated coverage. Final release
posture remains **NO-GO**.

## Scope

This slice adds `test/rpp-0556-same-key-same-body-replay-v3.test.js`.
The generated harness proves the replay decision contract with hash/count-only
public evidence:

- same idempotency key plus same canonical request body returns the committed
  receipt;
- replay starts zero fresh mutation work, applies zero mutations, and writes
  zero duplicate receipt rows;
- same key with a different canonical body fails closed as a conflict;
- missing committed receipt evidence fails closed; and
- stale replay scope fails closed.

## Public Evidence Shape

The public projection records counts, booleans, status codes, gate names, and
SHA-256-shaped hashes only. It does not include raw idempotency keys, request
bodies, paths, session identifiers, credentials, signatures, receipt keys, or
source URLs.

Observed generated counts:

- generated cases: `2`
- committed receipt replays: `2`
- different-body blocks: `2`
- missing committed receipt blocks: `2`
- stale scope blocks: `2`
- duplicate mutation work: `0`
- duplicate receipt rows written: `0`
- mutation boundaries opened during replay: `0`
- public request bodies included: `0`
- public raw values included: `0`

## Gates

The focused proof checks seven local gates:

1. `same-key-same-canonical-body-replays-committed-receipt`
2. `no-duplicate-mutation-work`
3. `different-body-fails-closed`
4. `missing-committed-receipt-fails-closed`
5. `stale-scope-fails-closed`
6. `hash-count-only-public-projection`
7. `support-only-release-no-go`

All seven gates are expected to pass locally. Release movement remains blocked
with `releaseStatus: NO-GO`, `integrationRecommendation: NO-GO`, and
`releaseMovement.allowed: false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0556-same-key-same-body-replay-v3.test.js
node --test --test-name-pattern RPP-0556 test/rpp-0556-same-key-same-body-replay-v3.test.js
node --test --test-name-pattern RPP-0536 test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test --test-name-pattern RPP-0557 test/rpp-0557-same-key-different-body-conflict-v3.test.js
node --test --test-name-pattern RPP-0615 test/rpp-0615-same-key-replay-after-rejection.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0556-same-key-same-body-replay-v3.md
git diff --check
```

Observed local result: all listed commands exited `0`. Focused RPP-0556
coverage reported `1` file-level pass and `0` failures.

## Recommendation

Keep this as support-only generated coverage. Do not move release posture until
the same same-key same-canonical-body replay behavior and fail-closed variants
are accepted by the checked production release boundary.
