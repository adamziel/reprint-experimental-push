# RPP-0551 Application Password integration, variant 3

Date: 2026-05-31

Status: generated local support evidence only. Final release remains **NO-GO**
until the Application Password path is proven against a checked production-owned
live endpoint.

## Scope

`test/rpp-0551-application-password-integration-v3.test.js` adds deterministic
support coverage for the Application Password integration boundary without
starting a listener, opening a public ingress, using a tunnel, or calling a
production endpoint.

The generated proof covers:

- a positive scoped Application Password binding/readback case;
- negative binding drift for another source/user;
- negative binding drift for another Application Password on the same source
  and user;
- auth source command readback drift; and
- the live endpoint unavailable blocker.

## Proven Behavior

- The positive generated case records `wordpress-core-application-password`
  as the expected verifier and keeps release posture at `NO-GO` because the
  evidence is support-only.
- The Application Password binding gate passes only when the checked source,
  checked user, credential source, credential user, and credential hash are
  bound in final-scope evidence.
- Binding drift fails closed with
  `APPLICATION_PASSWORD_BINDING_REQUIRED`, `releaseStatus: NO-GO`, and
  `mutationAttempted: false`.
- Auth source readback drift fails closed with
  `PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED`, `releaseStatus: NO-GO`, and
  `mutationAttempted: false`.
- The live endpoint unavailable case is pinned to
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `gates: 0/4`, and
  `mutationAttempted: false`.
- The support envelope stores source, user, and credential material as hashes
  or redacted placeholders only. Raw Application Passwords, Basic auth values,
  and credential command values are excluded from generated evidence and
  command output assertions.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0551-application-password-integration-v3.test.js
node --test --test-name-pattern RPP-0551 test/rpp-0551-application-password-integration-v3.test.js
node --test --test-name-pattern "Application Password" test/release-gate-application-password-binding-generated.test.js test/release-gate-application-password-binding-regression.test.js
node --test test/release-verifier-application-password-binding-carry-through-focused-regression.test.js
node --test --test-name-pattern RPP-0511 test/rpp-0511-application-password-integration.test.js
node --test --test-name-pattern RPP-0531 test/rpp-0531-application-password-integration.test.js
node --test --test-name-pattern RPP-0599 test/rpp-0599-credential-rotation-behavior-v5.test.js
```

Observed result: all listed commands exited 0. The RPP-0551 focused test
reported 1 file-level pass under the requested name pattern. Adjacent
Application Password release-gate tests reported 4 passes; the focused
release-verifier carry-through test reported 3 passes; RPP-0511 and RPP-0531
each reported 1 live loopback endpoint pass; the RPP-0599 v5 verifier test
reported 1 pass.

The adjacent release-gate, release-verifier, RPP-0511, and RPP-0531 tests
needed approval to run outside the filesystem sandbox because their existing
test code starts nested child processes. They used only local loopback
Playground/verifier execution and no tunnel.

Additional commands to run after this evidence file was added:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0551-application-password-integration-v3.md
git diff --check
git diff --cached --check
```

## Boundary

This is support-only generated coverage. It does not update release status,
progress artifacts, checklists, route registration, production credentials, or
live endpoint readiness. Promotion remains **NO-GO** until a separate checked
production-owned live endpoint proof covers the same Application Password
binding/readback behavior.
