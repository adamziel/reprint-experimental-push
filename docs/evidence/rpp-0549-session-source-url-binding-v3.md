# RPP-0549 session source URL binding proof, variant 3

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until this behavior is proven across the release boundary.

## Claim

Apply revalidates the live source before mutation. The short-lived push session
and dry-run receipt carry source identity hashes, and apply rejects source drift
before mutation setup or mutation work can run.

## Proof Surface

`test/rpp-0549-session-source-url-binding-v3.test.js` adds:

- a static route-order proof that signed apply checks the short-lived session
  source binding before canonical request acceptance, validates the dry-run
  receipt source binding before the DB-journal apply path, and revalidates the
  live source after `apply-started` but before the mutation executor; and
- a mocked production-shaped `runAuthenticatedHttpPush()` flow using
  `global.fetch`, with no listener, remote ingress, tunnel, credentials, or
  network-only evidence.

## Proven Behavior

The focused proof asserts:

- signed session issue evidence and dry-run receipt evidence both contain
  source identity and source URL hashes;
- apply performs one live source revalidation pass at
  `phase: "before-first-mutation"`;
- a drifted live source returns `AUTH_SOURCE_BINDING_MISMATCH` with
  `freshMutationWork: false` and `applied: 0`;
- recovery inspect, replay, DB-journal readback, mutation setup, and mutation
  work do not run after the source-binding rejection; and
- support evidence stores only hashes for receipt, plan, session, source
  identity, source URL, request, idempotency key, dry-run body, and binding
  evidence.

## Boundary

This is intentionally local generated support evidence. It does not claim
production readiness, external endpoint coverage, production durability, or
release-verifier carry-through. It supports integration by pinning the
executor/auth contract that live source binding is checked before mutation.

## Validation

Commands required for this slice:

```sh
node --check test/rpp-0549-session-source-url-binding-v3.test.js
node --test --test-name-pattern RPP-0549 test/rpp-0549-session-source-url-binding-v3.test.js
node --test --test-name-pattern RPP-0529 test/rpp-0529-session-source-url-binding-v2.test.js
node --test test/session-source-url-binding.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0549-session-source-url-binding-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0549 test
reported 2 passes / 0 failures. The adjacent RPP-0529 and base
session-source binding tests each reported 2 passes / 0 failures. The scoped
artifact redaction scan returned `"ok": true`; both whitespace checks exited 0.
