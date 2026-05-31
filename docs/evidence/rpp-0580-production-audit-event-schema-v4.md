# RPP-0580 production audit event schema, variant 4

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains **NO-GO**
until the same audit-schema route proof is checked against
production-owned auth inputs and release boundaries.

## Claim

`verify:release` must carry exactly one production audit event schema
route-evidence summary through `dbJournal.auditEventSchema`. Malformed or
missing schema evidence must be rejected before release movement, and all
support evidence must remain hash-only.

## Proof Surface

The focused regression test adds four checks:

- a mocked production-shaped executor flow reaches DB-journal readback,
  receives `dbJournal.auditEventSchema`, and wraps it in a verify:release-shaped
  held summary;
- malformed audit-schema redaction evidence is rejected as
  `PRODUCTION_AUDIT_EVENT_HASH_ONLY_REQUIRED`;
- missing audit-schema evidence is rejected as
  `PRODUCTION_AUDIT_EVENT_SCHEMA_REQUIRED`; and
- the combined verifier source still carries the DB-journal summary through the
  release proof spread while topology evidence does not duplicate it.

The generated proof objects store route names, booleans, counts, and SHA-256
digests only. They do not store raw auth material, endpoint origins, sessions,
idempotency material, request bodies, row values, journal payloads, or secrets.

## Proven Behavior

- The positive support path carries one
  `reprint-push-production-audit-event/v1` object at
  `dbJournal.auditEventSchema`.
- The carried schema includes route evidence for `production-shaped`, namespace
  `reprint/v1`, journal route `/push/db-journal`, schema route
  `/push/db-journal/schema`, and checked surface
  `production-shaped-rest-route`.
- The verify:release-shaped support summary contains exactly one production
  audit event schema route-evidence summary.
- Malformed hash-only/redaction schema evidence and missing schema evidence
  both keep release status at `NO-GO` with `releaseMovement.allowed: false`.
- Source, auth, session, idempotency, row, and journal payload material are
  excluded from the support summary or represented only as SHA-256 digests.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0580-production-audit-event-schema-v4.test.js
node --test --test-name-pattern RPP-0580 test/rpp-0580-production-audit-event-schema-v4.test.js
node --test --test-name-pattern RPP-0560 test/rpp-0560-production-audit-event-schema-v3.test.js
node --test --test-name-pattern RPP-0540 test/rpp-0540-production-audit-event-schema-v2.test.js
node --test test/production-audit-event-schema-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0580-production-audit-event-schema-v4.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0580 test
reported 4 passes / 0 failures. The adjacent RPP-0560 proof reported 3 passes
/ 0 failures, the adjacent RPP-0540 proof reported 3 passes / 0 failures, and
the production audit schema route test reported 3 passes / 0 failures. The
scoped artifact redaction scan returned `"ok": true`; both whitespace checks
returned no findings.

## Boundary

This proof is intentionally local executor/auth support evidence. It does not
claim production durability, external endpoint coverage, or release readiness.
Integration should keep release gates **NO-GO** until checked
production-owned endpoint proof carries the same single
`dbJournal.auditEventSchema` summary.
