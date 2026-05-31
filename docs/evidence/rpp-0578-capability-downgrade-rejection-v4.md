# RPP-0578 capability downgrade rejection, variant 4

Date: 2026-05-31

Status: local executor-auth support evidence only. Final release remains
**NO-GO** until equivalent behavior is proven at the checked production
boundary.

## Claim

A dry-run receipt remains trustworthy for an apply attempt only when its subject
binding still matches the authenticated session, identity, scope, and canonical
plan hash. If capability evidence is downgraded after dry-run, apply is rejected
with `SIGNED_SESSION_CAPABILITY_DOWNGRADED` before receipt movement or
mutation-capable work.

## Proof Surface

This slice adds focused regression coverage for variant 4:

- source-order assertions keep signed-session capability rejection before
  canonical request acceptance, replay-marker claiming, JSON parsing, receipt
  validation, and mutation entry;
- a positive support path accepts a dry-run receipt and checks the subject,
  issue, session-user, request, and plan bindings against the canonical plan
  hash; and
- three downgrade cases reject before receipt movement and before any
  mutation-capable counters advance.

The support material is deterministic and local. It does not use live
endpoints, production credentials, remote ingress, remote tunnels, network
dependent evidence, row values, or journal payloads.

## Hash-Only Evidence Shape

The generated support envelopes assert only hashes, booleans, counts, status
markers, and capability downgrade codes. The positive envelope binds receipt,
subject, issue, session-user, request, precondition-set, mutation-set, and
canonical plan hashes. The negative envelopes bind each rejection to the same
receipt hash, plan hash, session hash, identity hash, scope hash, auth-session
hash, request hash, issued capability hash, and observed capability hash.

Raw credentials, account identifiers, source locations, sessions, signing
material, idempotency material, ephemeral request proofs, request bodies, local
filesystem identifiers, row values, journal payloads, and secrets are excluded.

## Validation

Requested syntax, focused regression, adjacent regression, redaction, and
whitespace checks all exited 0. The focused variant 4 test reported four passes
and zero failures. Adjacent capability downgrade regressions for variants 1, 2,
and 3 also exited 0. The scoped artifact redaction scan returned `"ok": true`.

## Boundary

This is support-only evidence and does not move the release gate. Integration
recommendation: keep release status **NO-GO** until the same receipt-binding and
capability-downgrade rejection behavior is proven at the production-owned
boundary.
