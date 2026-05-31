# RPP-0548 short-lived push session proof, variant 3

Date: 2026-05-31

Status: local generated executor/auth support evidence only. Final release
remains **NO-GO** until equivalent receipt-binding behavior is proven against a
checked production endpoint and release boundary.

## Claim

Dry-run receipts must bind the server-minted short-lived push session to the
authenticated identity, authenticated scope, auth session, and canonical plan
hash before any apply or mutation admission path can trust the receipt.

## Proof Surface

`test/rpp-0548-short-lived-push-session-v3.test.js` adds two local checks:

- a static route-order proof that signed dry-run verification happens before
  receipt binding, and apply validates the authenticated dry-run receipt before
  the DB-journal mutation path; and
- a mocked production-shaped `runAuthenticatedHttpPush()` dry-run-only flow
  over three deterministic generated ready cases: file create/update/delete
  mix, serialized options, and wp_posts create/update/delete.

No live production endpoint, listener, remote ingress, credentials, or tunnel
was used. The generated flow uses mocked `fetch` responses only.

## Proven Behavior

- The route source binds dry-run receipts with subject, issue, session-user,
  request, plan, precondition, and snapshot-hash evidence before recomputing the
  receipt hash.
- Apply recomputes the expected subject and short-lived push-session issue
  bindings before mutation admission.
- Each generated dry-run receipt carries matching SHA-256 hashes for the
  canonical plan, subject binding, authenticated identity, auth session, push
  session, scope, and issue binding.
- The mocked dry-run flow remains dry-run-only: no apply request, replay,
  recovery inspect, DB-journal readback, or mutation path is reached.
- Proof envelopes are support-only and `NO-GO`, with only hashes, counts, TTL,
  and status markers. Raw session tokens, identity values, source locations, and
  plan bodies are asserted absent.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0548-short-lived-push-session-v3.test.js
node --test --test-name-pattern RPP-0548 test/rpp-0548-short-lived-push-session-v3.test.js
node --test --test-name-pattern RPP-0528 test/rpp-0528-short-lived-push-session-v2.test.js
node --test test/short-lived-push-session.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0548-short-lived-push-session-v3.md
git diff --check
git diff --cached --check
```

Observed result: the syntax check exited 0. The focused RPP-0548 test reported
2 passes / 0 failures. The adjacent RPP-0528 test reported 4 passes / 0
failures, and the base short-lived push session test reported 3 passes / 0
failures. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks exited 0.

## Boundary

This proof is deterministic, local, and support-only. It does not claim
external production endpoint coverage or release readiness. The integration
recommendation is `NO-GO` for final release movement from this slice alone.
