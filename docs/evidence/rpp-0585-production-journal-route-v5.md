# RPP-0585 production journal route, variant 5

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same journal-route proof is checked against
production-owned URL and credential inputs.

## Claim

The generated production journal-route proof must carry exactly one read-only,
hash-only route-evidence summary into a `verify:release`-shaped support
summary. Missing, malformed, duplicated, or drifted route evidence must fail
closed as `JOURNAL_ROUTE_READ_ONLY_REQUIRED` without invoking mutation-capable
work.

## Proof Surface

`test/rpp-0585-production-journal-route-v5.test.js` adds three generated
checks:

- a mocked production-shaped executor/auth flow reaches the DB-journal readback
  path with a signed `GET`, omits mutating idempotency material, and carries
  one `productionJournalRoute` summary through a `verify:release`-shaped
  support result;
- missing, malformed, duplicated, and drifted generated route proof all block
  release movement as `JOURNAL_ROUTE_READ_ONLY_REQUIRED`, while the release-gate
  evaluator remains read-only and reports no mutation attempt; and
- a combined-verifier source check proves topology evidence does not duplicate
  the journal route summary and the release proof spread remains the carry
  path.

No listener, tunnel, public ingress, live credential, or external URL is used by
the test. The generated receipt stores route metadata, booleans, counts, and
SHA-256 hashes only.

## Proven Behavior

- The generated route receipt reaches the production-shaped DB-journal path
  with method `GET`, route profile `production-shaped`, namespace
  `reprint/v1`, and route prefix `/push`.
- The DB-journal read is session-bound and idempotency-free; dry-run and apply
  remain the idempotency-bound mutating steps.
- Journal row counts stay stable across the read, and the route receipt records
  no release-state mutation.
- The `verify:release`-shaped support summary contains exactly one production
  journal route-evidence summary at `productionJournalRoute`.
- Missing summary, mutating-idempotency summary, duplicate summary, and drifted
  route-proof hash all fail closed with `JOURNAL_ROUTE_READ_ONLY_REQUIRED`.
- Source, credential, user login, session id, idempotency key, private payload,
  journal scope, and resource values are excluded from the support summary or
  represented as SHA-256 hashes.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0585-production-journal-route-v5.test.js
node --test --test-name-pattern RPP-0585 test/rpp-0585-production-journal-route-v5.test.js
node --test --test-name-pattern RPP-0565 test/rpp-0565-production-journal-route-v4.test.js
node --test --test-name-pattern RPP-0545 test/rpp-0545-production-journal-route-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0585-production-journal-route-v5.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0585 test reported
3 passes / 0 failures. The adjacent RPP-0565 and RPP-0545 route proof checks
passed. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks returned no findings.

## Boundary

This proof is intentionally generated support evidence. It does not claim
production durability, external endpoint coverage, or release readiness.
Promotion requires the same single-summary journal route evidence from a
checked production-owned endpoint with valid production credentials.
