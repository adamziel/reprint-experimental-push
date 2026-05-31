# RPP-0539 credential rotation behavior, variant 2

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the behavior is proven against a checked production endpoint and
release boundary.

## Claim

Apply must revalidate the live source before mutation when credentials rotate.
Old credentials must fail closed, rotated credentials must be bound to the
authenticated push session and dry-run receipt, and stale live-source evidence
must stop mutation setup with hash-only support evidence.

## Proof Surface

`test/rpp-0539-credential-rotation-behavior-v2.test.js` adds:

- a static route-order proof that signed apply checks credential/session/source
  binding before JSON mutation setup, validates the dry-run receipt before the
  DB-journal apply path, and runs live-source revalidation before the mutation
  executor; and
- a mocked production-shaped `runAuthenticatedHttpPush()` flow using
  `global.fetch`, with no listener, remote ingress, or tunnel.

The mocked flow uses a rotated credential for preflight, snapshot, dry-run, and
apply. The dry-run receipt binds the rotated credential hash, application
password UUID hash, session hash, user hash, source hash, plan hash,
precondition set hash, mutation set hash, and dry-run idempotency key hash.

## Proven Behavior

The focused proof asserts:

- the old credential cannot preflight and cannot reuse the rotated
  session/receipt on apply;
- old-credential apply returns `SIGNED_SESSION_BINDING_MISMATCH` with
  `freshMutationWork: false`;
- the rotated dry-run receipt is bound to the rotated credential hash and not
  the old credential hash;
- apply enters one live revalidation pass before first mutation, detects stale
  live remote state as `PRECONDITION_FAILED`, and reports
  `phase: "before-first-mutation"` plus `checkedAgainst: "live-remote"`;
- no recovery inspect, replay, DB-journal readback, mutation setup, or mutation
  work occurs after the stale live-source rejection; and
- support evidence stores hashes for credential, application password UUID,
  receipt, plan, session, user, idempotency key, request, source binding, and
  stale remote hashes, without raw credential, session, idempotency, path, URL,
  scope, or fixture payload values.

## Boundary

This is intentionally local support evidence. It does not claim release
readiness, production durability, or external endpoint coverage. It supports
integration by pinning the executor/auth contract for credential rotation and
live-source revalidation before mutation.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0539-credential-rotation-behavior-v2.test.js
node --test test/rpp-0539-credential-rotation-behavior-v2.test.js
node --test test/rpp-0519-credential-rotation.test.js
node --test --test-name-pattern='RPP-0519|credential rotation|signed sessions bind credential|session user identity|idempotency key|same-key|same-body|canonicalizes signed query' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0539-credential-rotation-behavior-v2.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0539 test
reported 2 passes / 0 failures. The adjacent RPP-0519 credential-rotation proof
reported 2 passes / 0 failures. The authenticated-client auth/session and
idempotency subset reported 6 passes / 0 failures. The scoped artifact
redaction scan returned `"ok": true`; both whitespace checks exited 0.
