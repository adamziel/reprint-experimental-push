# RPP-0589 session source URL binding proof, variant 5

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until this behavior is proven across the release boundary.

## Claim

The release verifier carries the session source URL binding contract through
apply: a source-bound dry-run receipt must be revalidated against the live
source before mutation-capable work. Missing, malformed, stale, or drifted
source binding evidence is rejected before mutation setup.

## Proof Surface

`test/rpp-0589-session-source-url-binding-v5.test.js` adds:

- a static route-order proof that signed apply validates session and receipt
  source binding before the DB-journal apply path, and revalidates the live
  source after `apply-started` but before the mutation executor;
- a static release-verifier carry-through proof that
  `production-shaped-release-verify.mjs` requires production auth/session
  source evidence and asserts before-mutation apply revalidation fields;
- a mocked invalid-binding matrix for missing, malformed, stale, and drifted
  source URL binding evidence; and
- accepted and rejected support paths that store only hash material plus
  non-secret status labels.

## Proven Behavior

The focused proof asserts:

- the release verifier invokes the authenticated push client with production
  auth/session source requirements and durable-journal proof enabled;
- the verifier checks `phase: "before-first-mutation"`,
  `checkedAgainst: "live-remote"`, plan and receipt binding, exact verified
  mutation keys, and an active claim sequence;
- invalid source URL binding evidence returns `AUTH_RECEIPT_MISMATCH` or
  `AUTH_SOURCE_BINDING_MISMATCH` before recovery inspect, replay, DB-journal
  readback, mutation setup, or mutation work; and
- accepted apply records hash-only live-source revalidation before mutation.

## Boundary

This is intentionally local generated support evidence. It does not claim
production readiness, external endpoint coverage, production durability, or
final release readiness. It supports integration by pinning the executor/auth
contract that the live source binding is checked before mutation.

## Validation

Commands required for this slice:

```sh
node --check test/rpp-0589-session-source-url-binding-v5.test.js
node --test --test-name-pattern RPP-0589 test/rpp-0589-session-source-url-binding-v5.test.js
node --test --test-name-pattern RPP-0569 test/rpp-0569-session-source-url-binding-v4.test.js
node --test --test-name-pattern RPP-0549 test/rpp-0549-session-source-url-binding-v3.test.js
node --test --test-name-pattern RPP-0529 test/rpp-0529-session-source-url-binding-v2.test.js
node --test test/session-source-url-binding.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0589-session-source-url-binding-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0589 test
reported 5 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks exited 0.
