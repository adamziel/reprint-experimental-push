# Critic Verdict

Current reliable head: `c245a6fd14911d58af43c21fb605ef97b15dda39`
(`Use packaged release boundary in verify`).

Verdict: `0/4`

Reason:

- This head reroutes `scripts/playground/production-shaped-live-release-verify.mjs`
  so `verify:release` uses the packaged production-plugin source path when
  `REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION=1` and no explicit live source
  is supplied. It also updates `test/protocol-fixtures.test.js` to require
  `routeProfile.labBacked: false`, `boundary.verdict:
  "PACKAGED_RELEASE_BOUNDARY_OK"`, and a 300s bounded timeout for the full
  `verify:release` fixture. Reliable also reported passing `timeout 300s npm
  run verify:release` and the targeted protocol fixture before pushing.
- That is still retained verifier wiring and packaged-boundary classification,
  not a new releasable production source-boundary primitive. The packaged
  `/wp-json/reprint/v1/push/*` path still routes through the lab REST plugin
  machinery, and this head does not add a branch-local proof of production
  auth/session lifecycle plus durable journal storage semantics outside
  Playground. The supervised release gates therefore remain closed at `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond packaged
  wrapper/boundary wiring: a production-backed source mutation/auth-session
  boundary on the checked packaged release path that does not fall back to the
  lab REST plugin and that proves durable journal storage/lease semantics
  outside Playground. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
