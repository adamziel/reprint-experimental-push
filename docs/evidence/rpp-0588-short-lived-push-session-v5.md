# RPP-0588 short-lived push session proof, variant 5

Date: 2026-05-31

Status: local executor/auth release-verifier support evidence only. Final
release remains **NO-GO** until equivalent behavior is checked against the
production-owned release boundary.

## Claim

Dry-run receipts can support later apply-capable work only when the receipt
binds the short-lived push session issue to the authenticated identity, auth
session, requested scope, and canonical plan hash before mutation admission.

## Proof Surface

`test/rpp-0588-short-lived-push-session-v5.test.js` adds a focused local
variant 5 verifier proof:

- source-order assertions keep signed dry-run verification before receipt
  binding, and keep authenticated receipt validation before the apply/journal
  mutation path;
- a dry-run-only mocked production-shaped flow proves the receipt subject,
  issue, session-user, request, and plan hashes agree on the canonical plan and
  bounded push session; and
- a 16-case fail-closed matrix covers expired, missing, malformed, drifted, and
  stale receipt/session evidence before mutation-capable work.

No live endpoint, production credential, public ingress, remote tunnel, or
external network dependency was used.

## Hash-Only Evidence Shape

The support envelopes contain only hashes, counts, booleans, TTL, and status
markers. The positive verifier envelope records:

- receipt hash, canonical plan hash, subject binding hash, issue hash,
  session-user binding hash, and verifier hash;
- subject hashes for scope, identity, auth session, push session, and plan;
- issue hashes for session, signing key, scope, identity, capability, source,
  source location, and user identity;
- request hashes for dry-run content, canonical request, idempotency binding,
  and plan payload; and
- no-mutation markers showing dry-run-only execution and no release-eligible
  state.

The negative envelopes hash the negative case label, negative category, refusal
reason, receipt binding surface, request reference, and verifier reference.
All refusal cases assert `beforeMutationCapableWork: true`,
`mutationPrepared: 0`, `mutationApplied: 0`, and `releaseEligible: false`.

Raw credentials, usernames, source locations, sessions, signing keys,
idempotency keys, nonces, request bodies, bearer tokens, fixture values, and
mutation payloads are asserted absent from the support envelopes.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0588-short-lived-push-session-v5.test.js
node --test --test-name-pattern RPP-0588 test/rpp-0588-short-lived-push-session-v5.test.js
node --test --test-name-pattern RPP-0568 test/rpp-0568-short-lived-push-session-v4.test.js
node --test --test-name-pattern RPP-0548 test/rpp-0548-short-lived-push-session-v3.test.js
node --test --test-name-pattern RPP-0528 test/rpp-0528-short-lived-push-session-v2.test.js
node --test test/short-lived-push-session.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0588-short-lived-push-session-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0588 test
reported 3 passes / 0 failures. The adjacent RPP-0568 test reported 3 passes /
0 failures, the RPP-0548 test reported 2 passes / 0 failures, the RPP-0528 test
reported 4 passes / 0 failures, and the base short-lived push session test
reported 3 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is deterministic, local, hash-only, and support-only. It does not
claim production endpoint coverage, production credential validity, or final
release readiness. Integration recommendation: **NO-GO** for release movement
from this slice alone.
