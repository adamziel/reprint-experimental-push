# RPP-0569 session source URL binding proof, variant 4

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until this behavior is proven across the release boundary.

## Claim

Apply revalidates the live source URL and source binding before mutation. A
drifted source binding is rejected before mutation-capable work, and an accepted
support path records before-mutation live-source revalidation using hash-only
proof material.

## Proof Surface

The focused regression adds:

- a static route-order proof that signed apply checks session and receipt source
  binding before canonical apply acceptance and before the mutation executor;
- a mocked drift path where apply returns `AUTH_SOURCE_BINDING_MISMATCH` with
  no replay, recovery readback, mutation setup, or mutation work; and
- a mocked accepted path where apply records `phase: "before-first-mutation"`
  and `checkedAgainst: "live-remote"` before mutation work, while support
  evidence stores only hashes for request, plan, receipt, source identity,
  source URL, binding, snapshot, claim, resource-key set, session issue, dry-run
  body, and idempotency material.

## Proven Behavior

The support proof asserts:

- the dry-run receipt and short-lived push-session issue share the same
  source hash and source URL hash;
- rejected apply performs exactly one live-source revalidation and fails closed
  before mutation setup or mutation work;
- accepted apply performs exactly one live-source revalidation before mutation
  work and preserves matching current and receipt source hashes; and
- proof material is reduced to hashes plus non-secret status labels before
  redaction checks.

## Boundary

This is intentionally local generated support evidence. It does not claim
production readiness, external endpoint coverage, production durability, or
release-verifier carry-through. It supports integration by pinning the
executor/auth contract that live source binding is checked before mutation.

## Validation

Observed result: the requested syntax check, focused RPP-0569 regression,
adjacent RPP-0549 and RPP-0529 regressions, base session-source binding suite,
scoped artifact redaction scan, and both whitespace checks all exited 0.
