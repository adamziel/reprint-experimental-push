# RPP-0540 production audit event schema, variant 2

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same audit schema route evidence is proven against a
checked production-backed endpoint and release boundary.

## Claim

The production audit event schema must be carried through the same local
route/journal summary path that `verify:release` consumes, without duplicating
the schema in a second summary block. Negative auth failures must stay
hash-only, raw credential/session/payload values must be absent from the
support evidence, and this proof must not move release posture.

## Proof Surface

`test/rpp-0540-production-audit-event-schema-v2.test.js` adds three local
checks:

- a mocked production-shaped `runAuthenticatedHttpPush()` flow that reaches
  `dbJournal.auditEventSchema` through the authenticated DB-journal readback
  path, then wraps that sanitized journal summary in a verify:release-shaped
  `NO-GO` support summary;
- a mocked auth-failure path that records credential, source, session, payload,
  and idempotency evidence only as SHA-256 hashes and leaves `dbJournal` absent;
  and
- a static combined-verifier source check proving
  `emitCombinedReleaseProof()` carries the release proof with `...verify` while
  topology evidence does not duplicate `auditEventSchema`.

No listener, remote ingress, or tunnel was started. The successful and negative
flows use mocked `fetch` only with a non-loopback example source URL.

## Proven Behavior

- The successful local proof carries exactly one
  `reprint-push-production-audit-event/v1` object at
  `dbJournal.auditEventSchema`.
- The carried schema includes route evidence for `production-shaped`,
  namespace `reprint/v1`, journal route `/push/db-journal`, schema route
  `/push/db-journal/schema`, and checked surface
  `production-shaped-rest-route`.
- The verify:release-shaped support summary keeps
  `releaseStatus: "NO-GO"`, `releaseMovement.allowed: false`, and boundary
  verdict `PRODUCTION_EVIDENCE_REQUIRED`.
- The negative auth path stores only hash evidence for credential, source,
  session, payload, and idempotency values, with no DB-journal summary.
- The support summary omits raw username, application password, idempotency key,
  session id, and private payload/option values.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0540-production-audit-event-schema-v2.test.js
node --test test/rpp-0540-production-audit-event-schema-v2.test.js
node --test test/production-audit-event-schema-route.test.js
node --test --test-name-pattern "RPP-0520" test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0540-production-audit-event-schema-v2.md
git diff --check
git diff --cached --check
```

Observed result: the syntax check exited 0. The focused RPP-0540 test reported
3 passes / 0 failures. The adjacent RPP-0520 route test reported 3 passes / 0
failures, and the adjacent authenticated-client RPP-0520 check reported 1 pass
/ 0 failures. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks exited 0.

## Boundary

This proof is intentionally local executor/auth support evidence. It does not
claim production durability, external endpoint coverage, or release readiness.
The integration recommendation is to wire the same
`dbJournal.auditEventSchema` route-evidence block into the production-backed
release artifact only after the checked endpoint proof exists.
