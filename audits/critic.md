# Critic Verdict

Current reliable head: `2aa02bf7954f93bc4219a16e31e2a6b7c2166b16`
(`Bind packaged auth source to runtime URL`).

Verdict: `0/4`

Reason:

- This head tightens the packaged release proof emitted by
  `scripts/playground/production-shaped-release-verify.mjs`. It threads the
  runtime Playground base URL, username, and application password into
  `bindPackagedProductionPluginRuntimeSource()`, rebuilds the packaged
  auth-session source command through
  `scripts/playground/packaged-production-plugin-source-command.js`, and makes
  `test/protocol-fixtures.test.js` fail if the emitted
  `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ... sourceUrl:'http://127.0.0.1:8080'`
  proof stays pinned to the stale setup URL instead of the actual runtime port.
- That closes a proof-address consistency gap only. It does not change the
  supervised release boundary itself: the checked path is still the packaged
  Playground verifier path, still centered on packaged auth-session source
  wiring, and still does not prove a production-owned mutation boundary on the
  real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage, lease fencing, and apply-time
  revalidation outside the Playground package-mode scaffolding. The supervised
  release gates therefore remain closed at `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond runtime
  auth-source consistency: a production-owned, non-lab-backed source
  mutation/auth-session boundary on the real Reprint endpoint that proves
  live auth/session issuance plus readback on that endpoint, restart-readable
  durable journal rows with lease fencing, and apply-time revalidation before
  mutation without falling back to Playground package-mode verifier
  scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
