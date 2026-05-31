# RPP-0545 production journal route, variant 3

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same journal-route proof is checked against
production-owned URL and credential inputs.

## Claim

The generated production journal-route proof must carry one read-only,
hash-only route-evidence block into a `verify:release`-shaped summary. The
proof must stay support-only, use a signed session-bound `GET` read, omit a
mutating idempotency key, and avoid raw source, credential, session, payload, or
journal values.

## Proof Surface

`test/rpp-0545-production-journal-route-v3.test.js` adds three generated
checks:

- a mocked production-shaped executor flow reaches the DB-journal readback path
  with an idempotency-free signed `GET` and wraps the route receipt in a
  `verify:release`-shaped `NO-GO` summary;
- a generated legacy read that carries a mutating idempotency key fails closed
  as `JOURNAL_ROUTE_READ_ONLY_REQUIRED`; and
- a source-level combined-verifier check proves generated journal-route
  evidence is carried by the release proof spread while topology evidence does
  not duplicate that summary.

No listener, tunnel, public ingress, live credential, or external URL is used by
the test. The mocked executor route stores only hashes, counts, booleans,
method/path metadata, and summary hashes in the support evidence.

## Proven Behavior

- The generated route receipt reaches
  `/wp-json/reprint/v1/push/db-journal?limit=80` with method `GET`, route
  profile `production-shaped`, namespace `reprint/v1`, and route prefix
  `/push`.
- The DB-journal read is session-bound and idempotency-free; dry-run and apply
  remain the idempotency-bound mutating steps.
- Journal row counts stay stable across the read, and the route receipt records
  no release-state mutation.
- The `verify:release`-shaped support summary contains exactly one
  production journal route-evidence block at `productionJournalRoute`.
- Source, credential, user login, session id, idempotency key, private payload,
  journal scope, and resource values are excluded from the support summary or
  represented as SHA-256 hashes.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0545-production-journal-route-v3.test.js
node --test --test-name-pattern RPP-0545 test/rpp-0545-production-journal-route-v3.test.js
node --test test/release-gate-journal-route-read-only-generated.test.js test/release-verifier-journal-route-carry-through-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0545-production-journal-route-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0545 test reported
3 passes / 0 failures. The adjacent release-gate journal route bundle reported
3 passes / 0 failures. The scoped artifact redaction scan returned `"ok": true`;
both whitespace checks returned no findings.

## Boundary

This proof is intentionally generated support evidence. It does not claim
production durability, external endpoint coverage, or release readiness.
Promotion requires the same single-summary journal route evidence from a
checked production-owned endpoint with valid production credentials.
