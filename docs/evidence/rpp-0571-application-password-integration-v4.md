# RPP-0571 Application Password integration, variant 4

Date: 2026-06-01

Status: focused local live-endpoint regression evidence only. Final release
remains **NO-GO** until the Application Password path is proven against a
checked production-owned live endpoint with production-owned access material.

## Scope

`test/rpp-0571-application-password-integration-v4.test.js` adds focused
regression coverage for the executor-auth Application Password integration
boundary using a disposable WordPress Playground HTTP fixture bound to
sandbox-local loopback only.

The proof starts no dashboard service, uses no tunnel, publishes no ephemeral
port, and does not edit package metadata, progress surfaces, checklists, route
registration, or shared release artifacts.

## Proven Behavior

- The live REST index exposes the production-shaped preflight and
  snapshot-hashes routes plus the core `users/me` route.
- A valid but unscoped administrator Application Password authenticates to the
  core route, then fails closed on the production-shaped push preflight route.
- A limited user Application Password cannot authenticate to the
  production-shaped push preflight route.
- The scoped Application Password reaches the production-shaped preflight
  endpoint on the live fixture and reports
  `wordpress-core-application-password`, `production-auth-session`,
  `credentialScope: reprint-push-lab:authenticated-http-push`,
  `credentialType: push-application-password`, `playgroundFallback: false`,
  `manage_options: true`, and `sessionStore.type: wp-options`.
- The scoped session is then reused on the live snapshot-hashes route, which
  returns planning-only read evidence and receipt bindings for the same
  production-shaped session.
- A rotated or mismatched credential cannot reuse the scoped session and is
  denied before successful route work.
- Raw Application Password values and Basic authorization tokens are asserted
  absent from response bodies; credential and session material is represented
  by hashes or UUIDs only.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0571-application-password-integration-v4.test.js
node --test --test-name-pattern RPP-0571 test/rpp-0571-application-password-integration-v4.test.js
node --test --test-name-pattern RPP-0551 test/rpp-0551-application-password-integration-v3.test.js
node --test --test-name-pattern RPP-0599 test/rpp-0599-credential-rotation-behavior-v5.test.js
node --test --test-name-pattern RPP-0511 test/rpp-0511-application-password-integration.test.js
node --test --test-name-pattern RPP-0531 test/rpp-0531-application-password-integration.test.js
```

Observed result: all listed commands exited 0. The focused RPP-0571 test
reported 1 pass / 0 failures against a sandbox-local loopback live HTTP
fixture. Adjacent RPP-0551 and RPP-0599 each reported 1 pass / 0 failures.
The predecessor live endpoint proofs RPP-0511 and RPP-0531 each reported
1 pass / 0 failures.

Additional artifact redaction and diff whitespace scans were run before
commit; see the terminal report for exact command results.

## Boundary

This is support-only local evidence. It proves the focused regression against a
real loopback URL in the sandbox, but it does not claim production durability,
external endpoint coverage, production-owned credentials, or release readiness.
Release movement remains **NO-GO**.
