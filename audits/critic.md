# Critic Verdict

Current reliable head: `35dc26ec1d3536ef1aabfa57c31f1ed1e02c6317`
(`Honor matching runtime auth request state`).

Verdict: `0/4`

Reason:

- This head widens the checked release verifier's auth-session request-state
  resolution so matching runtime auth sources can come from either the remote
  or local runtime candidates, and the focused proof adds coverage for that
  matching override behavior.
- In `scripts/playground/production-shaped-release-verify.mjs` the checked
  release path now passes explicit `remoteUrl` and `localUrl` candidates into
  auth-session request-state resolution, and the new test proves a matching
  source can override explicit runtime credentials when it matches one of
  those candidates.
- That is still release-path support evidence, not a supervised gate closure.
  The checked path remains verifier/scaffold-driven, and this head still does
  not prove a production-owned, non-lab-backed source mutation boundary on the
  real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond matching
  runtime auth request-state resolution: a production-owned, non-lab-backed
  source-mutation/auth-session boundary on the real Reprint endpoint that
  issues a live session on the endpoint, reads it back after restart from
  durable journal storage, enforces lease-fenced ownership of those journal
  rows, and revalidates the session at apply time before mutation without
  falling back to Playground package-mode scaffolding. The proof should come
  through `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
