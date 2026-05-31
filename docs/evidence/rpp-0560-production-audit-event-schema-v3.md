# RPP-0560 production audit event schema, variant 3

Date: 2026-05-31

Status: local/generated support evidence only. Final release remains **NO-GO**
until the same audit-schema route evidence is checked against production-owned
auth inputs and release boundaries.

## Claim

`verify:release` must carry exactly one production audit event schema
route-evidence summary through `dbJournal.auditEventSchema`. The generated
support proof must also show that DB-journal readback includes the schema, that
negative auth evidence is hash-only, and that neither path can move release.

## Proof Surface

`test/rpp-0560-production-audit-event-schema-v3.test.js` adds three focused
checks:

- a deterministic generated executor flow reaches the authenticated
  DB-journal readback path, receives `dbJournal.auditEventSchema`, and wraps it
  in a `verify:release`-shaped `NO-GO` summary;
- generated auth-failure evidence records source, auth, session, payload, and
  idempotency material only as SHA-256 hashes, leaves `dbJournal` absent, and
  keeps release movement blocked; and
- a source-level release-wrapper check proves the combined verifier carries
  `dbJournal` through the release proof spread while topology evidence does not
  duplicate `auditEventSchema`.

No listener, public ingress, live endpoint, remote tunnel, production auth
input, or network-dependent evidence is used by the test. The generated proof
objects store route names, booleans, counts, and hashes only.

## Proven Behavior

- The generated DB-journal readback includes one
  `reprint-push-production-audit-event/v1` schema at
  `dbJournal.auditEventSchema`.
- That schema carries route evidence for `production-shaped`, namespace
  `reprint/v1`, journal route `/push/db-journal`, schema route
  `/push/db-journal/schema`, and checked surface
  `production-shaped-rest-route`.
- The `verify:release`-shaped support summary contains exactly one production
  audit event schema route-evidence summary, at `dbJournal.auditEventSchema`.
- Auxiliary audit-schema proof fields carry only hashes and pointers, so they
  do not duplicate the route-evidence object.
- The auth-failure path has no DB-journal readback, no audit-schema summary,
  and only hash evidence for private auth and request material.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0560-production-audit-event-schema-v3.test.js
node --test --test-name-pattern RPP-0560 test/rpp-0560-production-audit-event-schema-v3.test.js
node --test --test-name-pattern RPP-0540 test/rpp-0540-production-audit-event-schema-v2.test.js
node --test test/production-audit-event-schema-route.test.js
node --test --test-name-pattern RPP-0520 test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0560-production-audit-event-schema-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0560 test
reported 3 passes / 0 failures. The adjacent RPP-0540 proof reported 3 passes
/ 0 failures, the production audit schema route test reported 3 passes / 0
failures, and the adjacent authenticated-client RPP-0520 check reported 1 pass
/ 0 failures. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks returned no findings.

## Boundary

This proof is intentionally local/generated support evidence. It does not
claim production durability, external endpoint coverage, or release readiness.
Integration should keep the release gates NO-GO until a separate checked
production-owned endpoint proof carries the same single
`dbJournal.auditEventSchema` summary.
