# RPP-0531 Application Password integration live-endpoint evidence

Date: 2026-05-31

## Scope

RPP-0531 proves the executor-auth Application Password integration boundary on
a real local live URL. This slice is intentionally limited to focused endpoint
evidence and does not change route registration, credential handling, release
summaries, progress logs, or checklist state.

## Live endpoint proof

- Command: `node --test test/rpp-0531-application-password-integration.test.js`
- Observed result: exit 0; TAP reported 1 test and 1 pass in about 32 seconds.
- The focused test starts a sandbox-local loopback WordPress Playground server
  with the production-shaped REST routes mounted from the mu-plugin fixture.
- It discovers both `GET /wp-json/reprint/v1/push/preflight` and the core
  `GET /wp-json/wp/v2/users/me` route in the live REST index.
- It proves a valid but unscoped WordPress Application Password authenticates
  to the core `users/me` endpoint as an administrator, then fails the
  production-shaped push preflight with `401 reprint_push_lab_auth_required`.
- It proves the scoped push Application Password authenticates to the same
  live WordPress host, reaches the production-shaped preflight endpoint, and
  reports `auth.session.verifier: wordpress-core-application-password`.
- The successful scoped response reports `production-auth-session`,
  `auth.session.playgroundFallback: false`, the expected push credential scope
  and type, hash-only credential/session/user/capability/source evidence, and
  `sessionStore.type: wp-options`.
- The same scoped Application Password also authorizes the adjacent
  production-shaped snapshot read endpoint on the live URL.
- The live URL stayed on sandbox-local loopback with no remote tunnel. The
  exact ephemeral local port is intentionally not published in this artifact.

## Focused validation commands

- `node --check test/rpp-0531-application-password-integration.test.js` - exit 0.
- `node --test test/rpp-0531-application-password-integration.test.js` - exit 0, 1 subtest.
- `php -l scripts/playground/push-remote-rest-plugin.php` - exit 0.
- `node --test test/rpp-0511-application-password-integration.test.js` - exit 0, 1 subtest.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0531-application-password-integration-live-endpoint.md` - exit 0.
- `git diff --check` - exit 0.

## Residual risks

- The proof uses a disposable local WordPress Playground server rather than an
  externally reachable production host.
- The route remains backed by the local Playground fixture; this proof is
  specifically for WordPress core Application Password behavior at the live
  endpoint boundary.
