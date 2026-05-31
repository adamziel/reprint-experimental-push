# RPP-0538 capability downgrade rejection, variant 2

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same rejection and receipt-binding behavior is proven
against a checked production endpoint and release boundary.

## Claim

A short-lived authenticated push session that loses the required capability
after dry-run must be rejected before mutation work. The dry-run receipt must
remain bound to the push session, authenticated identity, authenticated scope,
and plan hash, and support evidence must record only hashes for sensitive
values.

## Proof Surface

`test/rpp-0538-capability-downgrade-rejection-v2.test.js` adds two local
checks:

- a static route-order check that the signed-session capability check runs
  before canonical request verification, nonce claiming, JSON parsing, receipt
  validation, or DB-journal mutation entry; and
- a mocked `runAuthenticatedHttpPush()` production-shaped flow where preflight
  and dry-run succeed, the dry-run receipt carries subject/session/user/scope
  and plan bindings, and apply returns
  `SIGNED_SESSION_CAPABILITY_DOWNGRADED` with zero prepared or applied mutation
  events.

No loopback listener, remote ingress, or tunnel was started. The test uses a
mocked `fetch` path only.

## Proven Behavior

The focused proof asserts:

- request order is preflight, snapshot, dry-run, then apply rejection;
- apply rejection returns HTTP 403 with
  `SIGNED_SESSION_CAPABILITY_DOWNGRADED`;
- no replay, recovery inspect, DB journal readback, mutation setup, or mutation
  work occurs after the downgrade rejection;
- dry-run and apply use the same authenticated session header and idempotency
  header, but support evidence stores only their SHA-256 hashes;
- the dry-run receipt plan hash equals the locally built plan hash;
- receipt auth binding carries scope, subject binding, identity binding,
  auth-session binding, push-session binding, issue binding, session-user
  binding, and precondition/mutation set hashes;
- client-side `sessionUserIdentityBinding` accepts the dry-run receipt before
  the later apply rejection; and
- support evidence excludes raw credential, idempotency key, session id,
  username, scope string, capability name, and fixture content.

## Boundary

This is not production-backed release evidence. It supports integration by
pinning the authenticated executor contract and the hash-only evidence shape,
but it does not change final release posture.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0538-capability-downgrade-rejection-v2.test.js
node --test test/rpp-0538-capability-downgrade-rejection-v2.test.js
node --test test/rpp-0518-capability-downgrade-rejection.test.js
node --test test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test --test-name-pattern='RPP-0518|capability downgrade|same-key|same-body|idempotency key|idempotent signed posts|canonicalizes signed query' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0538-capability-downgrade-rejection-v2.md
git diff --check
git diff --cached --check
```

Observed focused result so far: syntax check exited 0 and the RPP-0538 focused
test reported 2 passes / 0 failures. The adjacent RPP-0518 capability proof
reported 3 passes / 0 failures, RPP-0536 same-key replay reported 1 pass / 0
failures, and the authenticated-client capability/idempotency subset reported 9
passes / 0 failures. The scoped artifact redaction scan returned `"ok": true`.
Both `git diff --check` and `git diff --cached --check` exited 0.
