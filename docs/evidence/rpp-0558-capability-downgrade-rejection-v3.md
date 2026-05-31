# RPP-0558 capability downgrade rejection, variant 3

Date: 2026-05-31

Status: local/generated executor-auth support evidence only. Final release remains **NO-GO**
until the same downgrade rejection and dry-run receipt binding behavior is
proven against a checked production endpoint and release boundary.

## Claim

A short-lived authenticated push session with downgraded capability evidence is
rejected before mutation authority can be used. The dry-run receipt remains
bound to session, identity, scope, required capability, capability hash, and plan hash,
while generated support proof material stays hash-only.

## Proof Surface

`test/rpp-0558-capability-downgrade-rejection-v3.test.js` adds three focused
checks:

- a static route-order check proving signed apply runs the session capability
  check before canonical request acceptance, nonce claiming, JSON parsing,
  receipt validation, or DB-journal mutation entry;
- a mocked production-shaped executor flow where preflight and dry-run succeed,
  apply returns `SIGNED_SESSION_CAPABILITY_DOWNGRADED`, and no mutation setup,
  mutation work, replay, recovery inspect, or journal readback occurs; and
- a generated hash-only support envelope with three deterministic downgrade
  rejection cases tied back to the same dry-run receipt binding.

No loopback listener, live endpoint, production credential, public ingress, or
remote tunnel is used. The test uses mocked `fetch` responses only.

## Proven Behavior

- Request order is preflight, snapshot, dry-run, then apply rejection.
- Apply rejection returns HTTP 403 with
  `SIGNED_SESSION_CAPABILITY_DOWNGRADED`.
- Mutation authority remains unavailable: prepared, applied, and precondition
  failure mutation counters stay zero.
- Dry-run and apply use the same authenticated session and idempotency headers,
  but support evidence stores only their hashes.
- The dry-run receipt plan hash equals the locally built plan hash.
- Receipt subject binding carries scope, identity, auth-session, push-session,
  and plan hashes.
- Receipt issue binding carries session, identity, scope, required capability,
  and capability hashes.
- Client-side session-user identity binding accepts the dry-run receipt before
  the later apply rejection.
- Generated support evidence excludes raw credential, idempotency, session,
  user, scope, route, endpoint, request-body, and fixture-content material.

## Validation

Commands required for this slice:

```sh
node --check test/rpp-0558-capability-downgrade-rejection-v3.test.js
node --test --test-name-pattern RPP-0558 test/rpp-0558-capability-downgrade-rejection-v3.test.js
node --test test/rpp-0538-capability-downgrade-rejection-v2.test.js test/rpp-0518-capability-downgrade-rejection.test.js
node --test --test-name-pattern 'RPP-0518|capability downgrade|same-key|same-body|idempotency key|idempotent signed posts|canonicalizes signed query' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0558-capability-downgrade-rejection-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0558 test
reported 3 passes / 0 failures. The adjacent RPP-0518/RPP-0538 capability
bundle reported 5 passes / 0 failures, and the authenticated-client subset
reported 9 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is support-only and NO-GO scoped. It does not use network-dependent
evidence and does not change release gates. Integration should treat it as
generated executor-auth evidence until a separate checked production-owned
release proof exists.
