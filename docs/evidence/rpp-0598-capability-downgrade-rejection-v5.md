# RPP-0598 capability downgrade rejection, variant 5

Date: 2026-05-31

Status: local executor-auth release-verifier support evidence only. Final release remains **NO-GO** until equivalent behavior is checked at the production-owned release boundary.

## Claim

The release-verifier-shaped support proof carries capability downgrade rejection evidence only when accepted dry-run receipts bind session, identity, scope, and canonical plan hash before any release movement decision.

## Proof Surface

This slice adds deterministic local coverage for variant 5:

- source-order assertions keep the signed-session capability check before
  canonical request acceptance, replay-marker claiming, JSON parsing, receipt
  validation, mutation-capable work, and release movement;
- a positive dry-run support path accepts a receipt and checks the subject,
  issue, session-user, request, scope, and plan bindings against the canonical
  plan hash; and
- downgraded, missing, malformed, stale, and drifted capability evidence is
  rejected before JSON parsing, receipt work, mutation-capable work, or release movement.

No live endpoint, production credential, remote tunnel, public ingress, or
external network dependency is used.

## Hash-Only Evidence Shape

Support envelopes contain only hashes, booleans, counts, status markers, and
capability rejection codes. The positive envelope binds receipt, subject,
issue, session-user, request, scope, precondition-set, mutation-set, capability
evidence, and canonical plan hashes. Negative envelopes bind each rejection to
hashes for the case, category, validation result, request, receipt, session,
identity, auth session, scope, capability evidence, issued capability, observed
capability, and canonical plan.

Raw credentials, account identifiers, source locations, sessions, signing
material, idempotency material, one-time request proofs, request bodies, auth
header material, local filesystem identifiers, row values, journal payloads, and
secrets are excluded.

## Validation

Requested syntax, focused regression, adjacent downgrade regressions,
redaction, and whitespace checks are the validation surface for this slice.
The focused run is expected to report four passes and zero failures. Adjacent
variant 1, 2, 3, and 4 downgrade regressions remain part of the support bundle.

## Boundary

This is support-only evidence and does not move the release gate. Integration
recommendation: keep release status **NO-GO** until the same receipt-binding
and capability-downgrade rejection behavior is proven at the checked
production-owned boundary.
