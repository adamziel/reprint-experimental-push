# Critic Verdict

Current reliable head: `450be8ecdba058ad8a2a38e29eaf1894892b576f`
(`Require release-boundary auth session read`).

Verdict: `0/4`

Reason:

- This head is material auth/session release-boundary hardening. In
  `src/authenticated-http-push-client.js` and
  `test/authenticated-http-push-client.test.js`, the checked production-session
  path now requires the preserved auth-session read to stay coherent when
  `auth.identity.userLogin` or the observed auth envelope drifts. That is
  narrower than the earlier malformed lifecycle-field rejection and more
  relevant to the release boundary because the preserved read now has to stay
  valid long enough to be consumed by journal/replay evidence.
- The proof is still inside checked verifier scaffolding, not a releasable
  production source-boundary primitive. `450be8ec` does not yet prove a
  production-owned real Reprint boundary with live auth/session issuance and
  readback, restart-readable durable journal storage with lease fencing, and
  apply-time revalidation on the real endpoint. Verdict therefore remains
  `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond auth-read
  drift hardening: a production-owned, non-lab-backed source
  mutation/auth-session boundary on the real Reprint endpoint that issues a
  live session on the endpoint, reads it back from restart-readable durable
  journal storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back
  to Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` with `timeout 300s npm run
  verify:release`.
