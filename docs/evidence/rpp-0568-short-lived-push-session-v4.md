# RPP-0568 short-lived push session proof, variant 4

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until equivalent receipt-binding behavior is proven against the
checked production boundary.

## Claim

Dry-run receipts are trustworthy for later apply-capable work only when they
bind the server-minted short-lived push session to the authenticated identity,
auth session, requested scope, and canonical plan hash.

## Proof Surface

This slice adds focused local regression coverage for variant 4:

- source-order assertions that signed dry-run verification precedes receipt
  binding, and apply validates the authenticated dry-run receipt before the
  mutation/journal path;
- one dry-run-only mocked production-shaped flow that proves the receipt subject,
  issue, session-user, request, and plan bindings all agree on the canonical
  plan hash and bounded push session; and
- a fail-closed matrix for session drift, identity drift, scope drift, auth
  session drift, plan drift, missing subject binding, missing issue binding, and
  receipt expiry.

No live endpoint, production credential, remote tunnel, external network
dependency, or mutation-capable backend was used.

## Hash-Only Evidence Shape

The regression asserts support envelopes containing only hashes, counts,
booleans, TTL, and status markers. The positive envelope covers:

- receipt hash, canonical plan hash, subject binding hash, issue hash, and
  session-user binding hash;
- subject hashes for scope, identity, auth session, push session, and plan;
- issue hashes for session, signing key, scope, identity, capability, source,
  source location, and user identity;
- request hashes for dry-run content, canonical request, idempotency binding,
  and plan payload; and
- no-mutation markers showing dry-run-only execution.

The negative envelopes hash the negative case label, reason, receipt binding
surface, request reference, and refusal summary. All refusal cases asserted
`beforeMutationCapableWork: true`, `mutationPrepared: 0`, and
`mutationApplied: 0`.

Raw credentials, usernames, source locations, sessions, signing keys,
idempotency keys, nonces, request bodies, tokens, fixture values, and mutation
payloads are asserted absent from the support envelopes.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0568-short-lived-push-session-v4.test.js
node --test --test-name-pattern RPP-0568 test/rpp-0568-short-lived-push-session-v4.test.js
node --test --test-name-pattern RPP-0548 test/rpp-0548-short-lived-push-session-v3.test.js
node --test --test-name-pattern RPP-0528 test/rpp-0528-short-lived-push-session-v2.test.js
node --test test/short-lived-push-session.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0568-short-lived-push-session-v4.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0568 test
reported 3 passes / 0 failures. The adjacent RPP-0548 test reported 2 passes /
0 failures, the RPP-0528 test reported 4 passes / 0 failures, and the base
short-lived push session test reported 3 passes / 0 failures. The scoped
artifact redaction scan returned `"ok": true`; both whitespace checks returned
no findings.

## Boundary

This proof is deterministic, local, and support-only. It does not claim release
readiness or production endpoint coverage. Integration recommendation:
**NO-GO** for release movement from this slice alone.
