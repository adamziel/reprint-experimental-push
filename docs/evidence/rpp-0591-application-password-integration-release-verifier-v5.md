# RPP-0591 Application Password integration release verifier, variant 5

Date: 2026-06-01

Status: focused release-verifier live-endpoint support evidence only. Final
release posture remains **NO-GO**.

## Scope

`test/rpp-0591-application-password-integration-release-verifier-v5.test.js`
carries the RPP-0571 live WordPress Application Password shape through a
release-verifier-style support envelope. The live proof starts a disposable
WordPress Playground endpoint on sandbox-local loopback, authenticates through
core `users/me`, then exercises production-shaped preflight and
snapshot-hashes routes with the scoped Application Password.

No public tunnel, remote ingress, progress surface, checklist surface, route
registration, or shared release gate artifact is changed.

## Proven Behavior

- The focused proof makes real HTTP requests against a live loopback URL.
- WordPress core accepts the scoped Application Password on `users/me`.
- Production-shaped preflight returns `wordpress-core-application-password`,
  `production-auth-session`, `push-application-password`,
  `playgroundFallback: false`, `manage_options: true`, and `wp-options`
  session-store evidence.
- The same session is reused on snapshot-hashes, which returns planning-only
  read evidence plus receipt binding for the signed request session.
- The release-verifier projection stores credential, user, source, endpoint,
  Application Password UUID/app ID, and session facts as hashes, booleans,
  counts, or statuses only.
- Raw Application Passwords, Basic tokens, source URLs, endpoint URLs, user
  names, session ids, UUIDs, idempotency keys, and request bodies are excluded
  from the public support envelope.
- Missing live Application Password proof remains blocked before release
  movement.
- `releaseStatus` remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands for this slice:

```sh
node --check test/rpp-0591-application-password-integration-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0591 test/rpp-0591-application-password-integration-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0571 test/rpp-0571-application-password-integration-v4.test.js
node --test --test-name-pattern RPP-0551 test/rpp-0551-application-password-integration-v3.test.js
node --test --test-name-pattern RPP-0531 test/rpp-0531-application-password-integration.test.js
node --test --test-name-pattern RPP-0511 test/rpp-0511-application-password-integration.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0591-application-password-integration-release-verifier-v5.md
git diff --check
```

Observed result before commit: all listed commands exited 0. The focused
RPP-0591 run reported 3 passes / 0 failures, including the live URL proof.
Adjacent RPP-0571, RPP-0551, RPP-0531, and RPP-0511 Application Password runs
passed. The scoped artifact redaction scan returned `"ok": true`; whitespace
checks returned no findings.

## Recommendation

Carry RPP-0591 as support evidence that the Application Password live endpoint
shape reaches the release-verifier envelope. Do not move release posture until
the same boundary is checked against production-owned URL and credential
inputs.
