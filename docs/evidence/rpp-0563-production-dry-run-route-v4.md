# RPP-0563 production dry-run route, variant 4

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same dry-run receipt trust boundary is checked against
production-owned URL and credential inputs.

## Claim

Dry-run receipts are only trustable for apply-capable work when the current
push session, authenticated user identity, requested auth scope, and canonical
plan hash still match the receipt binding. Session, identity, scope, or
plan-hash drift must fail closed before mutation-capable work starts.

## Proof Surface

The focused RPP-0563 regression adds three checks:

- production apply source ordering keeps dry-run receipt validation before the
  mutation-capable apply path;
- an accepted production-shaped local dry-run receipt is wrapped as support-only
  evidence and validates the current session, identity, scope hash, subject
  binding, issue binding, session-user binding, receipt hash, and canonical plan
  hash; and
- session, identity, scope, and plan-hash drift cases are blocked before the
  receipt is trusted or any mutation-capable counter advances.

The test uses mocked fetch responses and deterministic local fixture data. It
does not start a listener, use public ingress, call live endpoints, use
production credentials, or depend on network-only evidence.

## Hash-Only Evidence Boundary

The support envelope records SHA-256 hashes or hash lengths for source,
credential, scope, identity, auth session, push session, signing-key,
idempotency-key, route, receipt, binding, and plan proof fields. It records only
booleans, counts, status values, and hashes for the trust decision.

Raw credentials, usernames, source URLs, sessions, signing keys, idempotency
keys, nonces, request bodies, tokens, row values, journal payloads, and local
paths are excluded from the evidence body.

## Proven Behavior

- Accepted dry-run evidence remains support-only with release status `NO-GO` and
  release movement disabled.
- The receipt hash recomputes from the receipt body with the hash field removed.
- The subject binding matches the requested scope hash, authenticated identity
  hash, auth-session hash, push-session hash, canonical plan hash, and binding
  hash.
- The issue and session-user bindings match the current authenticated identity
  and push session before the receipt is trusted.
- Session drift returns `DRY_RUN_RECEIPT_SESSION_BINDING_MISMATCH`.
- Identity drift returns `DRY_RUN_RECEIPT_IDENTITY_BINDING_MISMATCH`.
- Scope drift returns `DRY_RUN_RECEIPT_SCOPE_BINDING_MISMATCH`.
- Plan-hash drift returns `DRY_RUN_RECEIPT_PLAN_HASH_MISMATCH`.
- Each drift case records one receipt-validation attempt, zero trusted-receipt
  attempts, zero mutation-capable work attempts, and release movement disabled.

## Validation

Commands run for this slice were the requested syntax check, focused RPP-0563
test run, adjacent RPP-0543 regression run, production dry-run route regression
run, scoped artifact redaction scan, and staged/unstaged whitespace checks.

Observed result: all commands exited 0. The focused RPP-0563 test reported
3 passes / 0 failures. The adjacent RPP-0543 test reported 3 passes /
0 failures. The production dry-run route regression reported 6 passes /
0 failures. The scoped artifact redaction scan returned `"ok": true`, and both
whitespace checks returned no findings.

## Boundary

This proof is support-only and does not claim production durability or release
readiness. Promotion requires equivalent receipt binding proof from
production-owned auth inputs and the checked production route; until then the
release posture is **NO-GO**.
