# RPP-0559 credential rotation behavior, variant 3

Date: 2026-05-31

Status: local generated executor/auth support evidence only. Final release
remains **NO-GO** until the same behavior is proven against a checked
production-owned endpoint with production-owned credentials.

## Claim

Apply must revalidate the live source before mutation when credential binding
changes. A rotated credential or invalidated credential must fail before
mutation work, and the accepted apply path must record live-source
revalidation before the first mutation event.

## Proof Surface

`test/rpp-0559-credential-rotation-behavior-v3.test.js` adds:

- a source-order proof that signed apply checks credential/session binding
  before payload mutation admission, validates the authenticated receipt before
  DB-journal apply, and calls live-source revalidation before the mutation
  executor; and
- a deterministic generated route using mocked `fetch` only, with no listener,
  live endpoint, public ingress, remote tunnel, production credential, or
  network-dependent evidence.

The generated route mints a dry-run receipt bound to the accepted credential
hash, authenticated user hash, push-session hash, plan hash, precondition set
hash, mutation set hash, source hash, and dry-run idempotency hash. Rejection
and acceptance summaries contain hashes and counts only.

## Proven Behavior

- An invalidated apply credential returns auth failure before mutation executor
  entry and before mutation application.
- A rotated same-user apply credential returns
  `SIGNED_SESSION_BINDING_MISMATCH` before mutation executor entry and before
  mutation application.
- The accepted apply path records `apply-started`, then
  `live-source-revalidated`, then mutation executor entry, then the first
  mutation event.
- Accepted apply evidence reports `phase: before-first-mutation`,
  `checkedAgainst: live-remote`, and a verified count matching the mutation
  count.
- Support evidence stores credential, user, session, receipt, plan,
  idempotency, request, source, source-binding, precondition, mutation-set, and
  journal-cursor material as SHA-256 hashes, with release movement still
  blocked.

## Boundary

This is support-only generated evidence. It does not claim production
durability, external endpoint coverage, or release readiness. The release gate
remains **NO-GO** until executor/auth credential rotation and before-mutation
live-source revalidation are checked on the production boundary.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0559-credential-rotation-behavior-v3.test.js
node --test --test-name-pattern RPP-0559 test/rpp-0559-credential-rotation-behavior-v3.test.js
node --test --test-name-pattern RPP-0539 test/rpp-0539-credential-rotation-behavior-v2.test.js
node --test --test-name-pattern 'rotated|credential|auth/session boundary|live-source revalidation' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0559-credential-rotation-behavior-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0559 test
reported 2 passes / 0 failures. The adjacent RPP-0539 credential-rotation proof
reported 2 passes / 0 failures. The authenticated-client credential/session
subset reported 4 passes / 0 failures. The scoped artifact redaction scan
returned `"ok": true`; both whitespace checks returned no findings.
